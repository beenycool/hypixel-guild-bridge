import { setImmediate } from 'node:timers/promises'

import type { Client } from 'minecraft-protocol'
import { createClient, states } from 'minecraft-protocol'

import type Application from '../../application.js'
import type { ChannelType } from '../../common/application-event.js'
import {
  InstanceMessageType,
  InstanceReactiveType,
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
import LimboHandler from './handlers/limbo-handler.js'
import PlayerMuted from './handlers/player-muted.js'
import PunishmentHandler from './handlers/punishment-handler'
import Reaction from './handlers/reaction.js'
import SelfbroadcastHandler from './handlers/selfbroadcast-handler.js'
import StateHandler, { QuitOwnVolition } from './handlers/state-handler.js'
import { createIasAuthFunction, type IasAuthCache } from './microsoft-ias-auth.js'
import MinecraftBridge from './minecraft-bridge.js'

export default class MinecraftInstance extends ConnectableInstance<InstanceType.Minecraft> {
  readonly defaultHosts = ['me.hypixel.net', 'free.stopthelag.lol']
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

  private readonly messageAssociation: MessageAssociation
  private readonly bridge: MinecraftBridge
  private readonly sendQueue: SendQueue

  private readonly config: MinecraftInstanceConfig

  /** Latest tab-list ping (ms) from Hypixel `player_info` for this bot; reset on reconnect. */
  private latestTabPingMs: number | undefined

  constructor(app: Application, instanceName: string, config: MinecraftInstanceConfig) {
    // Resolve the bridge ID for this instance from the application's bridge resolver
    const bridgeId = app.bridgeResolver.getBridgeIdForInstance(instanceName)
    super(app, instanceName, InstanceType.Minecraft, bridgeId)

    this.config = config

    this.messageAssociation = new MessageAssociation()
    this.bridge = new MinecraftBridge(app, this, this.logger, this.errorHandler, this.messageAssociation)
    this.sendQueue = new SendQueue(this.errorHandler, (command) => {
      this.sendNow(command)
    })

    this.stateHandler = new StateHandler(this.application, this, this.eventHelper, this.logger, this.errorHandler)
    this.selfbroadcastHandler = new SelfbroadcastHandler(
      this.application,
      this,
      this.eventHelper,
      this.logger,
      this.errorHandler
    )
    this.chatManager = new ChatManager(
      this.application,
      this,
      this.eventHelper,
      this.logger,
      this.errorHandler,
      this.messageAssociation
    )
    this.gameToggle = new GameTogglesHandler(this.application, this, this.eventHelper, this.logger, this.errorHandler)
    this.punishmentHandler = new PunishmentHandler(
      this.application,
      this,
      this.eventHelper,
      this.logger,
      this.errorHandler
    )
    this.limboHandler = new LimboHandler(this.application, this, this.eventHelper, this.logger, this.errorHandler)
    this.reactionHandler = new Reaction(this.application, this, this.eventHelper, this.logger, this.errorHandler)
    this.playerMuted = new PlayerMuted(this.application, this, this.eventHelper, this.logger, this.errorHandler)
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
      this.logger.debug(
        `instance is attempting to connect automatically but configured to not auto-connect. Attempt stopped.`
      )

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

    // #region agent log
    this.emitAgentDebugLog(
      'pre-fix',
      'H1,H4',
      'src/instance/minecraft/minecraft-instance.ts:automaticReconnect',
      'Minecraft reconnect auth selection',
      {
        autoConnect,
        currentHost,
        currentHostIndex: this.currentHostIndex,
        hasIasRefreshToken: usesIasAuth,
        iasRefreshTokenValueType: typeof iasTokenCache.token
      }
    )
    // #endregion

    const authOption = usesIasAuth
      ? createIasAuthFunction({
          instanceName: this.instanceName,
          cache: this.buildIasAuthCache(),
          onDebug: (location, message, data, hypothesisId) => {
            this.emitAgentDebugLog('pre-fix', hypothesisId, location, message, data)
          },
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
      // @ts-expect-error profilesFolder is directly passed to 'prismarine-auth'.Authflow, which that library also allow a factory function
      profilesFolder: usesIasAuth ? false : sessionsManager.getSessionsFactory(this.instanceName),

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
    this.clientSession?.client.end(QuitOwnVolition)

    // wait till next cycle to let the clients close properly
    await setImmediate()
    await this.setAndBroadcastNewStatus(Status.Ended)
  }

  username(): string | undefined {
    return this.clientSession?.client.username
  }

  uuid(): string | undefined {
    const uuid = this.clientSession?.client.uuid
    return uuid == undefined ? undefined : uuid.split('-').join('')
  }

  /**
   * In-game/tab-list latency (ms) for this bot as reported by Hypixel via `player_info`.
   * Undefined when not in play, disconnected, or before the first tab ping update.
   */
  public getTabPingMs(): number | undefined {
    if (this.currentStatus() !== Status.Connected) return undefined
    const client = this.clientSession?.client
    if (client === undefined || client.state !== states.PLAY) return undefined
    if (this.latestTabPingMs === undefined) return undefined
    return this.latestTabPingMs
  }

  notifyChatEvent(channel: ChannelType, message: string): void {
    this.sendQueue.notifyChatEvent(channel, message)
  }

  /**
   * returns {@link BaseEvent#eventId} of the last **MESSAGE** sent via {@link #send}.
   * Sent commands that aren't messages will NOT change this value.
   */
  getLastEventIdForSentChatMessage(): string | undefined {
    return this.sendQueue.lastId.get(CommandType.ChatMessage)
  }

  /**
   * returns {@link BaseEvent#eventId} of the last **GUILD ACTION** sent via {@link #send}.
   * Sent commands that aren't the type will NOT change this value.
   * commands the type are: guild chat message, guild change settings, guild info, etc.
   */
  getLastEventIdForSentGuildAction(): string | undefined {
    return this.sendQueue.lastId.get(CommandType.GuildCommand)
  }

  /**
   * Send a message/command via minecraft client.
   * The command will be queued to be sent in the future.
   *
   * @param message the message/command to send
   * @param priority when to handle the command
   * @param originEventId {@link BaseEvent#eventId} that resulted in this send. <code>undefined</code> if none.
   */
  async send(message: string, priority: MinecraftSendChatPriority, originEventId: string | undefined): Promise<void> {
    message = message
      .split('\n')
      .map((chunk) => chunk.trim())
      .join(' ')

    if (message.length > 256) {
      message = message.slice(0, 253) + '...'

      if (originEventId !== undefined) {
        await this.application.emit('instanceReactive', {
          ...this.eventHelper.fillBaseEvent(),

          originEventId: originEventId,
          type: InstanceReactiveType.MessageTruncated,
          message: `Message is too long! It has been shortened to fit minecraft message`
        })
      }
    }

    this.logger.debug(`Queuing message to send: ${message}`)
    await this.sendQueue.queue(message, priority, originEventId)
  }

  private sendNow(message: string) {
    if (this.clientSession?.client.state === states.PLAY) {
      this.logger.debug(`Sending message now: ${message}`)
      this.clientSession.client.chat(message)
    } else {
      this.logger.warn(`Dropping message due to client not being connected and ready: ${message}`)
    }
  }

  /**
   * Hypixel sends tab ping via `player_info` (`add_player` / `update_latency`, etc.).
   * Do not use `client.latency` — minecraft-protocol does not update it on the client for keep-alive in this stack.
   */
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

  private emitAgentDebugLog(
    runId: string,
    hypothesisId: string,
    location: string,
    message: string,
    data: Record<string, unknown>
  ): void {
    const payload = {
      sessionId: '6b9e0b',
      runId,
      hypothesisId,
      location,
      message,
      data: {
        instanceName: this.instanceName,
        ...data
      },
      timestamp: Date.now()
    }

    // #region agent log
    this.logger.info(`[agent-debug] ${JSON.stringify(payload)}`)
    void fetch('http://localhost:7841/ingest/96583079-93df-4c4e-95ed-e3e352350fef', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6b9e0b' },
      body: JSON.stringify(payload)
    }).catch(() => {})
    // #endregion
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
