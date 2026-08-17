import type { InstanceStatus, InstanceType } from '../../../common/application-event.js'
import { InstanceMessageType } from '../../../common/application-event.js'
import { Status } from '../../../common/connectable-instance.js'
import SubInstance from '../../../common/sub-instance'
import Duration from '../../../utility/duration'
import { setTimeoutAsync } from '../../../utility/scheduling'
import { formatTime } from '../../../utility/shared-utility'
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
  private authenticationCodeRequested: boolean
  private instanceStatusListener: ((event: InstanceStatus) => void) | undefined

  constructor(clientInstance: MinecraftInstance) {
    super(clientInstance)

    this.loginAttempts = 0
    this.loggedIn = false
    this.connectionTimeoutId = undefined
    this.authenticationCodeRequested = false
  }

  public resetLoginAttempts() {
    this.loginAttempts = 0
  }

  override registerEvents(clientSession: ClientSession): void {
    this.clearConnectionTimeout()
    this.authenticationCodeRequested = false

    this.instanceStatusListener = (event: InstanceStatus) => {
      if (
        event.instanceName === this.clientInstance.instanceName &&
        event.message?.type === InstanceMessageType.MinecraftAuthenticationCode
      ) {
        this.authenticationCodeRequested = true
      }
    }
    this.application.on('instanceStatus', this.instanceStatusListener)

    this.connectionTimeoutId = setTimeout(() => {
      this.clearInstanceStatusListener()

      if (this.clientInstance.currentStatus() === Status.Connecting && !this.loggedIn) {
        const timeoutMessage = this.authenticationCodeRequested
          ? `Authentication timeout after ${StateHandler.ConnectionTimeout.toSeconds()} seconds. The Microsoft authentication code may have expired or was not completed. Forcing disconnect to retry with a new code.`
          : `Connection timeout after ${StateHandler.ConnectionTimeout.toSeconds()} seconds. Forcing disconnect and retry.`

        this.logger.warn(timeoutMessage)

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
    this.clearInstanceStatusListener()
  }

  private clearInstanceStatusListener(): void {
    if (this.instanceStatusListener !== undefined) {
      this.application.off('instanceStatus', this.instanceStatusListener)
      this.instanceStatusListener = undefined
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

      if (!clientSession.silentQuit) {
        await this.clientInstance.broadcastInstanceMessage({ type: InstanceMessageType.MinecraftEnded, value: reason })
      }
      return
    } else if (reason === QuitOwnVolition) {
      // eslint-disable-next-line unicorn/prefer-ternary
      if (clientSession.silentQuit) {
        await this.clientInstance.setAndBroadcastNewStatus(Status.Ended)
      } else {
        await this.clientInstance.setAndBroadcastNewStatus(Status.Ended)
      }
      return
    }

    this.clientInstance.lastDisconnectMessage = { type: InstanceMessageType.MinecraftEnded, value: reason }
    this.clientInstance.lastDisconnectTime = Date.now()
    this.clientInstance.reconnectAttempts++
    await this.tryRestarting()
  }

  private async onKicked(reason: string): Promise<void> {
    this.logger.error(`Minecraft bot was kicked from the server for: ${reason}`)

    this.loginAttempts++
    this.clientInstance.reconnectAttempts++
    let messageType: InstanceMessageType
    if (reason.includes('You logged in from another location')) {
      messageType = InstanceMessageType.MinecraftKickedLoggedFromAnotherLocation
      this.logger.fatal('Instance will shut off since someone logged in from another place')
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Failed, {
        type: messageType,
        value: undefined
      })
    } else if (reason.includes('You are permanently banned') || reason.includes('You are temporarily banned')) {
      messageType = InstanceMessageType.MinecraftBanned
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Failed, {
        type: messageType,
        value: reason
      })
    } else if (
      reason.includes('Your account has been blocked') ||
      reason.includes('Your account is temporarily blocked')
    ) {
      messageType = InstanceMessageType.MinecraftBanned
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Failed, {
        type: messageType,
        value: reason
      })
    } else if (reason.includes('of Minecraft is disabled on Hypixel due to compatibility issues')) {
      messageType = InstanceMessageType.MinecraftIncompatible

      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Failed, {
        type: messageType,
        value: reason
      })
    } else {
      messageType = InstanceMessageType.MinecraftKicked
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Disconnected, {
        type: messageType,
        value: reason
      })
    }
    this.clientInstance.lastDisconnectMessage = { type: messageType, value: reason }
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

    let messageType: InstanceMessageType
    if (error.message.includes('socket disconnected before secure TLS connection')) {
      messageType = InstanceMessageType.MinecraftInternetProblems
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Disconnected, {
        type: messageType,
        value: error.message
      })
      await this.tryRestarting()
    } else if (error.message.includes('503 Service Unavailable')) {
      messageType = InstanceMessageType.MinecraftXboxDown
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Disconnected, {
        type: messageType,
        value: undefined
      })
      await this.tryRestarting()
    } else if (error.message.includes('Too Many Requests')) {
      messageType = InstanceMessageType.MinecraftXboxThrottled
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Disconnected, {
        type: messageType,
        value: undefined
      })
      await this.tryRestarting()
    } else if (
      error.message.includes('does the account own minecraft') ||
      error.message.includes('Profile not found')
    ) {
      messageType = InstanceMessageType.MinecraftNoAccount
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Disconnected, {
        type: messageType,
        value: undefined
      })

      this.application.core.minecraftSessions.clearCachedSessions(this.clientInstance.instanceName)
      await this.tryRestarting()
    } else {
      messageType = InstanceMessageType.MinecraftEnded
      this.clientInstance.lastDisconnectMessage = { type: messageType, value: error.message }
      this.clientInstance.lastDisconnectTime = Date.now()
      return
    }
    this.clientInstance.lastDisconnectMessage = { type: messageType, value: error.message }
    this.clientInstance.lastDisconnectTime = Date.now()
  }

  public override dispose(): void {
    this.clearInstanceStatusListener()
    this.clearConnectionTimeout()
  }

  private async tryRestarting(): Promise<void> {
    this.logger.info(`minecraft attempt ${this.loginAttempts}`)
    if (this.loginAttempts > StateHandler.MaxLoginAttempts) {
      this.logger.error(`Client failed to connect too many times. No further trying to reconnect.`)
      await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Failed, {
        type: InstanceMessageType.MinecraftFailedTooManyTimes,
        value: undefined
      })
      return
    }

    this.tryFallbackHost()

    let loginDelay = (this.loginAttempts + 1) * 5000
    if (loginDelay > StateHandler.MaxDuration.toMilliseconds()) loginDelay = StateHandler.MaxDuration.toMilliseconds()

    await this.clientInstance.setAndBroadcastNewStatusWithMessage(Status.Connecting, {
      type: InstanceMessageType.MinecraftRestarting,
      value: formatTime(Math.floor(loginDelay / 1000))
    })

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
