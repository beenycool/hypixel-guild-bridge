import { InstanceType } from '../../../common/application-event.js'
import { Status } from '../../../common/connectable-instance.js'
import SubInstance from '../../../common/sub-instance'
import Duration from '../../../utility/duration'
import { setTimeoutAsync } from '../../../utility/scheduling'
import type ClientSession from '../client-session.js'
import type MinecraftInstance from '../minecraft-instance'

export const QuitOwnVolition = 'disconnect.quitting'

export default class StateHandler extends SubInstance<MinecraftInstance, InstanceType.Minecraft, ClientSession> {
  private static readonly MaxLoginAttempts = 100
  private static readonly MaxDuration = Duration.minutes(5)
  private static readonly ConnectionTimeout = Duration.minutes(5)

  private loginAttempts
  private loggedIn
  private connectionTimeoutId: NodeJS.Timeout | undefined

  constructor(clientInstance: MinecraftInstance) {
    super(clientInstance)

    this.loginAttempts = 0
    this.loggedIn = false
    this.connectionTimeoutId = undefined
  }

  public resetLoginAttempts() {
    this.loginAttempts = 0
  }

  override registerEvents(clientSession: ClientSession): void {
    this.clearConnectionTimeout()

    this.connectionTimeoutId = setTimeout(() => {
      if (this.clientInstance.currentStatus() === Status.Connecting && !this.loggedIn) {
        this.logger.warn(
          `Connection timeout after ${StateHandler.ConnectionTimeout.toSeconds()} seconds. Forcing disconnect and retry.`
        )

        clientSession.client.end('Connection timeout - authentication or connection took too long')
      }
    }, StateHandler.ConnectionTimeout.toMilliseconds())

    clientSession.client.on('login', () => {
      this.clearConnectionTimeout()
      void this.onLogin().catch(this.errorHandler.promiseCatch('handling login event from Minecraft'))
      this.loggedIn = true
    })

    clientSession.client.on('end', (reason: string) => {
      this.clearConnectionTimeout()
      void this.onEnd(clientSession, reason).catch(this.errorHandler.promiseCatch('handling end event from Minecraft'))
      this.loggedIn = false
    })

    clientSession.client.on('kick_disconnect', (packet: { reason: string }) => {
      const formattedReason = clientSession.prismChat.fromNotch(packet.reason)
      void this.onKicked(formattedReason.toString()).catch(
        this.errorHandler.promiseCatch('handling kick_disconnect event from Minecraft')
      )
      this.loggedIn = false
    })
    clientSession.client.on('disconnect', (packet: { reason: string }) => {
      const formattedReason = clientSession.prismChat.fromNotch(packet.reason)
      void this.onKicked(formattedReason.toString()).catch(
        this.errorHandler.promiseCatch('handling disconnect event from Minecraft')
      )
      this.loggedIn = false
    })

    clientSession.client.on('error', (error: Error) => {
      this.clearConnectionTimeout()
      void this.onError(error).catch(this.errorHandler.promiseCatch('handling error event from Minecraft'))
    })
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimeoutId !== undefined) {
      clearTimeout(this.connectionTimeoutId)
      this.connectionTimeoutId = undefined
    }
  }

  private async onLogin(): Promise<void> {
    if (this.loggedIn) return

    this.clearConnectionTimeout()
    this.logger.info('Minecraft client ready, logged in')

    this.loginAttempts = 0
    this.clientInstance.reconnectAttempts = 0
    this.clientInstance.currentHostIndex = 0
    await this.clientInstance.setAndBroadcastNewStatus(Status.Connected)
    this.logger.info('Minecraft instance has connected')
  }

  private async onEnd(clientSession: ClientSession, reason: string): Promise<void> {
    if (this.clientInstance.currentStatus() === Status.Failed) {
      this.logger.warn(reason)
      return
    } else if (reason === QuitOwnVolition) {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Ended)
      return
    }

    this.clientInstance.lastDisconnectTime = Date.now()
    this.clientInstance.reconnectAttempts++
    await this.tryRestarting()
  }

  private async onKicked(reason: string): Promise<void> {
    this.logger.error(`Minecraft bot was kicked from the server for: ${reason}`)

    this.loginAttempts++
    this.clientInstance.reconnectAttempts++
    if (reason.includes('You logged in from another location')) {
      this.logger.fatal('Instance will shut off since someone logged in from another place')
      await this.clientInstance.setAndBroadcastNewStatus(Status.Failed)
    } else if (reason.includes('You are permanently banned') || reason.includes('You are temporarily banned')) {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Failed)
    } else if (
      reason.includes('Your account has been blocked') ||
      reason.includes('Your account is temporarily blocked')
    ) {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Failed)
    } else if (reason.includes('of Minecraft is disabled on Hypixel due to compatibility issues')) {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Failed)
    } else {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Disconnected)
    }
    this.clientInstance.lastDisconnectTime = Date.now()
  }

  private async onError(error: Error & { code?: string }): Promise<void> {
    this.logger.error('Minecraft Bot Error: ', error)
    this.loginAttempts++
    this.clientInstance.reconnectAttempts++

    if (error.code === 'EAI_AGAIN') {
      this.logger.error('Minecraft bot disconnected due to internet problems. Restarting client in 30 seconds...')
      await this.tryRestarting()
      return
    }

    if (error.message.includes('socket disconnected before secure TLS connection')) {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Disconnected)
      await this.tryRestarting()
    } else if (error.message.includes('503 Service Unavailable')) {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Disconnected)
      await this.tryRestarting()
    } else if (error.message.includes('Too Many Requests')) {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Disconnected)
      await this.tryRestarting()
    } else if (
      error.message.includes('does the account own minecraft') ||
      error.message.includes('Profile not found')
    ) {
      await this.clientInstance.setAndBroadcastNewStatus(Status.Disconnected)
      this.application.core.minecraftSessions.clearCachedSessions(this.clientInstance.instanceName)
      await this.tryRestarting()
    } else {
      this.clientInstance.lastDisconnectTime = Date.now()
      return
    }
    this.clientInstance.lastDisconnectTime = Date.now()
  }

  public override dispose(): void {
    this.clearConnectionTimeout()
  }

  private async tryRestarting(): Promise<void> {
    this.logger.info(`minecraft attempt ${this.loginAttempts}`)
    if (this.loginAttempts > StateHandler.MaxLoginAttempts) {
      this.logger.error(`Client failed to connect too many times. No further trying to reconnect.`)
      await this.clientInstance.setAndBroadcastNewStatus(Status.Failed)
      return
    }

    this.tryFallbackHost()

    let loginDelay = (this.loginAttempts + 1) * 5000
    if (loginDelay > StateHandler.MaxDuration.toMilliseconds()) loginDelay = StateHandler.MaxDuration.toMilliseconds()

    await this.clientInstance.setAndBroadcastNewStatus(Status.Connecting)

    setTimeoutAsync(() => this.clientInstance.automaticReconnect(), {
      delay: Duration.milliseconds(loginDelay),
      errorHandler: this.errorHandler.promiseCatch('trying to auto reconnect')
    })
  }

  private tryFallbackHost(): void {
    if (this.clientInstance.currentHostIndex < this.clientInstance.defaultHosts.length - 1) {
      this.clientInstance.currentHostIndex++
      this.logger.info(
        `Falling back to host: ${this.clientInstance.defaultHosts[this.clientInstance.currentHostIndex]}`
      )
    }
  }
}
