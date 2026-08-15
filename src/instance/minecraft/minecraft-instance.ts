import { setImmediate } from 'node:timers/promises'

import type { Client } from 'minecraft-protocol'
import { createClient, states } from 'minecraft-protocol'

import type Application from '../../application.js'
import type { ChannelType } from '../../common/application-event.js'
import {
  InstanceMessageType,
  InstanceSignalType,
  InstanceType,
  MinecraftSendChatPriority
} from '../../common/application-event.js'
import { ConnectableInstance, Status } from '../../common/connectable-instance.js'
import type { MinecraftInstanceConfig } from '../../core/minecraft/sessions-manager'
import type { Timeout } from '../../utility/timeout.js'

import ChatManager from './chat-manager.js'
import ClientSession from './client-session.js'
import MessageAssociation from './common/message-association.js'
import { resolveProxyIfExist } from './common/proxy-handler.js'
import { CommandType, SendQueue } from './common/send-queue.js'
import GameTogglesHandler from './handlers/game-toggles-handler.js'
import JoinInterviewHandler from './handlers/join-interview-handler.js'
import LimboHandler from './handlers/limbo-handler.js'
import PlayerMuted from './handlers/player-muted.js'
import PunishmentHandler from './handlers/punishment-handler'
import Reaction from './handlers/reaction.js'
import SelfbroadcastHandler from './handlers/selfbroadcast-handler.js'
import StateHandler, { QuitOwnVolition } from './handlers/state-handler.js'
import { createIasAuthFunction, type IasAuthCache } from './microsoft-ias-auth.js'
import MinecraftBridge from './minecraft-bridge.js'

export default class MinecraftInstance extends ConnectableInstance<InstanceType.Minecraft> {
  readonly defaultHosts = ['me.hypixel.net']
  readonly defaultPort = 25_565
  readonly defaultVersion = '1.8.9'
  public currentHostIndex = 0

  private clientSession: ClientSession | undefined

  private stateHandler: StateHandler
  private selfbroadcastHandler: SelfbroadcastHandler
  private chatManager: ChatManager
  private punishmentHandler: PunishmentHandler
  private gameToggle: GameTogglesHandler
  private reactionHandler: Reaction
  private playerMuted: PlayerMuted
  private limboHandler: LimboHandler
  private joinInterviewHandler: JoinInterviewHandler

  private readonly messageAssociation: MessageAssociation
  private readonly bridge: MinecraftBridge
  private readonly sendQueue: SendQueue

  private readonly config: MinecraftInstanceConfig

  private latestTabPingMs: number | undefined

  public lastDisconnectMessage: { type: string; value?: string } | undefined
  public lastDisconnectTime: number | undefined
  public reconnectAttempts = 0

  private cachedUuid?: string

  constructor(app: Application, instanceName: string, config: MinecraftInstanceConfig) {
    const bridgeId = app.bridgeResolver.getBridgeIdForInstance(instanceName)
    super(app, instanceName, InstanceType.Minecraft, bridgeId)

    this.config = config

    this.messageAssociation = new MessageAssociation()
    this.bridge = new MinecraftBridge(app, this, this.logger, this.errorHandler, this.messageAssociation)
    this.sendQueue = new SendQueue(
      this.errorHandler,
      (command) => {
        this.sendNow(command)
      },
      app.minecraftManager.sentChatMessages
    )

    this.stateHandler = new StateHandler(this)
    this.selfbroadcastHandler = new SelfbroadcastHandler(this)
    this.chatManager = new ChatManager(this, this.messageAssociation)
    this.gameToggle = new GameTogglesHandler(this)
    this.punishmentHandler = new PunishmentHandler(this)
    this.limboHandler = new LimboHandler(this)
    this.reactionHandler = new Reaction(this)
    this.playerMuted = new PlayerMuted(this)
    this.joinInterviewHandler = new JoinInterviewHandler(this)
  }

  override async signal(type: InstanceSignalType): Promise<void> {
    const connected = this.currentStatus() === Status.Connected

    if (type === InstanceSignalType.Restart) {
      this.application.core.minecraftSessions.setInstanceAutoConnect(this.instanceName, true)

      if (connected) {
        await this.send(`/gc @Instance restarting...`, MinecraftSendChatPriority.High, undefined)
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (type === InstanceSignalType.Shutdown) {
      this.application.core.minecraftSessions.setInstanceAutoConnect(this.instanceName, false)

      if (connected) {
        await this.send(`/gc @Instance shutting down...`, MinecraftSendChatPriority.High, undefined)
      }
    }

    return super.signal(type)
  }

  public async acquireLimbo(): Promise<Timeout<void>> {
    return this.limboHandler.acquire()
  }

  public isInterviewing(username: string): boolean {
    return this.joinInterviewHandler.isInterviewing(username)
  }

  async connect(): Promise<void> {
    if (this.clientSession !== undefined) {
      this.clientSession.silentQuit = true
      this.clientSession.client.end(QuitOwnVolition)
    }

    this.latestTabPingMs = undefined
    this.stateHandler.resetLoginAttempts()
    this.currentHostIndex = 0
    await this.automaticReconnect()
  }

  public async automaticReconnect(): Promise<void> {
    const autoConnect = this.application.core.minecraftSessions.getInstanceAutoConnect(this.instanceName)
    if (!autoConnect) {
      await this.broadcastInstanceMessage({
        type: InstanceMessageType.MinecraftInstanceNotAutoConnect,
        value: undefined
      })
      return
    }

    const currentHost = this.defaultHosts[this.currentHostIndex]
    this.logger.info(`Connecting to ${currentHost} (host ${this.currentHostIndex + 1}/${this.defaultHosts.length})`)

    this.latestTabPingMs = undefined

    const sessionsManager = this.application.core.minecraftSessions
    const iasTokenCache = sessionsManager.getCacheSync(this.instanceName, 'iasRefreshToken')
    const usesIasAuth = typeof iasTokenCache.token === 'string'

    const authOption = usesIasAuth
      ? createIasAuthFunction({
          instanceName: this.instanceName,
          cache: this.buildIasAuthCache(),
          onError: (message) => {
            this.logger.warn(`IAS auth error for ${this.instanceName}: ${message}`)
          }
        })
      : 'microsoft'

    const client = createClient({
      host: currentHost,
      port: this.defaultPort,
      version: this.defaultVersion,
      username: this.config.name,
      auth: authOption,

      profilesFolder: (usesIasAuth ? false : sessionsManager.getSessionsFactory(this.instanceName)) as unknown as
        | string
        | false,

      ...resolveProxyIfExist(this.logger, this.config.proxy, {
        host: currentHost,
        port: this.defaultPort
      }),
      onMsaCode: usesIasAuth
        ? undefined
        : (code) => {
            void this.broadcastInstanceMessage({
              type: InstanceMessageType.MinecraftAuthenticationCode,
              value: `${code.verification_uri}?otc=${code.user_code}`
            }).catch(this.errorHandler.promiseCatch('broadcasting authentication code'))
          }
    })

    this.clientSession = new ClientSession(client)
    this.registerTabPingTracking(client)

    this.selfbroadcastHandler.registerEvents(this.clientSession)
    this.stateHandler.registerEvents(this.clientSession)
    this.chatManager.registerEvents(this.clientSession)
    this.gameToggle.registerEvents(this.clientSession)
    this.limboHandler.registerEvents(this.clientSession)
    this.reactionHandler.registerEvents(this.clientSession)
    this.playerMuted.registerEvents(this.clientSession)

    await this.setAndBroadcastNewStatus(Status.Connecting)
  }

  async disconnect(): Promise<void> {
    this.latestTabPingMs = undefined
    this.cachedUuid = undefined
    this.clientSession?.client.end(QuitOwnVolition)
    this.reactionHandler.dispose()
    this.punishmentHandler.dispose()
    this.playerMuted.dispose()
    this.gameToggle.dispose()
    this.limboHandler.dispose()
    this.stateHandler.dispose()
    this.bridge.dispose()

    await setImmediate()
    await this.setAndBroadcastNewStatus(Status.Ended)
  }

  username(): string | undefined {
    return this.clientSession?.client.username
  }

  uuid(): string | undefined {
    const uuid = this.clientSession?.client.uuid
    if (uuid === undefined) return undefined
    this.cachedUuid ??= uuid.replaceAll('-', '')
    return this.cachedUuid
  }

  public getLunarCredentials(): { accessToken: string; uuid: string; username: string } | undefined {
    const client = this.clientSession?.client
    if (client === undefined || client.state !== states.PLAY) return undefined

    const session = client.session as { accessToken?: string } | undefined
    const accessToken = session?.accessToken
    const uuid = client.uuid as string | undefined
    const username = client.username as string | undefined

    if (accessToken === undefined || uuid === undefined || username === undefined) return undefined
    return { accessToken, uuid, username }
  }

  public getTabPingMs(): number | undefined {
    if (this.currentStatus() !== Status.Connected) return undefined
    const client = this.clientSession?.client
    if (client === undefined || client.state !== states.PLAY) return undefined
    if (this.latestTabPingMs === undefined) return undefined
    return this.latestTabPingMs
  }

  notifyChatEvent(channel: ChannelType, message: string): boolean {
    return this.sendQueue.notifyChatEvent(channel, message)
  }

  getLastEventIdForSentChatMessage(): string | undefined {
    return this.sendQueue.lastId.get(CommandType.ChatMessage)
  }

  getLastEventIdForSentGuildAction(): string | undefined {
    return this.sendQueue.lastId.get(CommandType.GuildCommand)
  }

  private static generateID(length: number): string {
    let result = ''
    const characters = 'abcde0123456789'
    for (let index = 0; index < length; index++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length))
    }
    return result
  }

  private static readonly MaxMinecraftMessageLength = 256

  private static splitMessage(message: string): string[] {
    if (message.length <= MinecraftInstance.MaxMinecraftMessageLength) return [message]

    const maxLength = MinecraftInstance.MaxMinecraftMessageLength

    const breakIndex = message.lastIndexOf(' ', maxLength)

    if (breakIndex > 0) {
      const part1 = message.slice(0, breakIndex)
      let part2 = message.slice(breakIndex + 1).trim()

      if (part2.length > maxLength) {
        part2 = part2.slice(0, maxLength - 3) + '...'
      }

      return [part1, part2]
    }

    const part1 = message.slice(0, maxLength)
    let part2 = message.slice(maxLength).trim()

    if (part2.length > maxLength) {
      part2 = part2.slice(0, maxLength - 3) + '...'
    }

    return [part1, part2]
  }

  async send(
    message: string,
    priority: MinecraftSendChatPriority,
    originEventId: string | undefined,
    maxRetries = 5
  ): Promise<void> {
    message = message
      .split('\n')
      .map((chunk) => chunk.trim())
      .join(' ')

    const parts = MinecraftInstance.splitMessage(message)

    for (const part of parts) {
      await this.sendSingle(part, priority, originEventId, maxRetries)
    }
  }

  private async sendSingle(
    message: string,
    priority: MinecraftSendChatPriority,
    originEventId: string | undefined,
    maxRetries: number
  ): Promise<void> {
    const startTime = Date.now()
    const maxExecutionTime = 10_000

    const sendWithRetry = async (messageToSend: string, isRetry: boolean): Promise<void> => {
      if (isRetry) await new Promise((resolve) => setTimeout(resolve, 100))

      return new Promise((resolve, reject) => {
        const client = this.clientSession?.client
        if (client === undefined || client.state !== states.PLAY) {
          resolve()
          return
        }

        let timeoutId: ReturnType<typeof setTimeout> | undefined

        const listener = (data: { formattedMessage?: string } | { message?: string } | string) => {
          let messageString: string
          if (typeof data === 'string') {
            messageString = data
          } else if ('formattedMessage' in data && typeof data.formattedMessage === 'string') {
            messageString = this.clientSession?.prismChat.fromNotch(data.formattedMessage).toString() ?? ''
          } else if ('message' in data && typeof data.message === 'string') {
            messageString = data.message
          } else {
            messageString = ''
          }

          if (messageString.includes('You cannot say the same message twice!')) {
            client.removeListener('systemChat', listener)
            client.removeListener('playerChat', listener)
            if (timeoutId !== undefined) clearTimeout(timeoutId)
            reject(new Error('duplicate-message'))
          }
        }

        this.sendQueue
          .queue(messageToSend, priority, originEventId)
          .then(() => {
            client.on('systemChat', listener)
            client.on('playerChat', listener)

            timeoutId = setTimeout(() => {
              client.removeListener('systemChat', listener)
              client.removeListener('playerChat', listener)
              resolve()
            }, 500)
          })
          .catch((error: unknown) => {
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      })
    }

    let currentMessage = message
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (Date.now() - startTime > maxExecutionTime) {
        this.logger.warn('Message sending timed out after 10 seconds')
        return
      }

      try {
        await sendWithRetry(currentMessage, attempt > 0)
        return
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'duplicate-message') {
          const randomId = MinecraftInstance.generateID(24)
          const maxLength = MinecraftInstance.MaxMinecraftMessageLength - randomId.length - 3
          currentMessage = `${currentMessage.slice(0, Math.max(0, maxLength))} - ${randomId}`
          continue
        }
        throw error
      }
    }
  }

  private sendNow(message: string) {
    if (this.clientSession?.client.state === states.PLAY) {
      this.clientSession.client.chat(message)
    }
  }

  private registerTabPingTracking(client: Client): void {
    client.on('player_info', (packet: unknown) => {
      if (packet === null || typeof packet !== 'object') return
      const data = (packet as { data?: unknown }).data
      if (!Array.isArray(data)) return

      const botUuidNormalized = MinecraftInstance.normalizeUuidForCompare(client.uuid)
      if (botUuidNormalized === undefined) return

      for (const raw of data) {
        if (raw === null || typeof raw !== 'object') continue
        const entry = raw as { uuid?: unknown; ping?: unknown; latency?: unknown }
        if (typeof entry.uuid !== 'string') continue
        const entryUuid = MinecraftInstance.normalizeUuidForCompare(entry.uuid)
        if (entryUuid !== botUuidNormalized) continue

        const pingRaw = entry.ping ?? entry.latency
        if (typeof pingRaw === 'number' && Number.isFinite(pingRaw)) {
          this.latestTabPingMs = Math.round(pingRaw)
        }
        break
      }
    })
  }

  private static normalizeUuidForCompare(uuid: string | undefined): string | undefined {
    if (uuid === undefined || uuid.length === 0) return undefined
    return uuid.replaceAll('-', '').toLowerCase()
  }

  private buildIasAuthCache(): IasAuthCache {
    const sessionsManager = this.application.core.minecraftSessions
    return {
      getCacheSync: (name: string, cacheName: string) => sessionsManager.getCacheSync(name, cacheName),
      setSession: (instanceName: string, name: string, cacheName: string, value: Record<string, unknown>) => {
        sessionsManager.setSession(instanceName, name, cacheName, value)
      },
      deleteSingleCache: (name: string, cacheName: string) => sessionsManager.deleteSingleCache(name, cacheName)
    }
  }
}
