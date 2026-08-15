import assert from 'node:assert'

import type { Guild, GuildMember, Message, Snowflake, User } from 'discord.js'
import { Client, GatewayIntentBits, Options, Partials } from 'discord.js'

import type { StaticDiscordConfig } from '../../application-config.js'
import type Application from '../../application.js'
import { InstanceType, Permission } from '../../common/application-event.js'
import { ConnectableInstance, Status } from '../../common/connectable-instance.js'
import type { DiscordProfile } from '../../common/user'

import ChatManager from './chat-manager.js'
import { CommandManager } from './command-manager.js'
import MessageAssociation from './common/message-association.js'
import DiscordBridge from './discord-bridge.js'
import GuildRequirements from './features/guild-requirements.js'
import LoggerManager from './features/logger-manager.js'
import StatsChannels from './features/stats-channels.js'
import TournamentButtons from './features/tournament-buttons.js'
import TournamentSignup from './features/tournament-signup.js'
import TournamentTestPanel from './features/tournament-test-panel.js'
import VerificationRoleManager from './features/verification-role-manager.js'
import EmojiHandler from './handlers/emoji-handler.js'
import StateHandler from './handlers/state-handler.js'
import StatusHandler from './handlers/status-handler.js'

export default class DiscordInstance extends ConnectableInstance<InstanceType.Discord> {
  private static readonly PermissionCacheTtl = 5 * 60 * 1000

  readonly commandsManager: CommandManager
  readonly guildRequirements: GuildRequirements
  readonly statsChannels: StatsChannels
  readonly verificationRoleManager: VerificationRoleManager
  readonly tournamentButtons: TournamentButtons
  readonly tournamentTestPanel: TournamentTestPanel
  readonly tournamentSignup: TournamentSignup

  private readonly client: Client

  private readonly stateHandler: StateHandler
  private readonly statusHandler: StatusHandler
  readonly emojiHandler: EmojiHandler
  private readonly chatManager: ChatManager
  private readonly loggerManager: LoggerManager

  private readonly bridge: DiscordBridge
  private readonly messageAssociation: MessageAssociation = new MessageAssociation()

  private readonly staticConfig: Readonly<StaticDiscordConfig>
  private connected = false
  private static readonly PermissionCacheMaxSize = 1000
  private permissionCache = new Map<string, { permission: Permission; expiresAt: number }>()

  constructor(app: Application, config: StaticDiscordConfig) {
    super(app, InstanceType.Discord, InstanceType.Discord)

    this.staticConfig = config

    this.client = new Client({
      /* eslint-disable @typescript-eslint/naming-convention -- discord.js cache manager keys must match Client manager property names */
      makeCache: Options.cacheWithLimits({
        ApplicationEmojiManager: {},
        AutoModerationRuleManager: { maxSize: 0 },
        DMMessageManager: { maxSize: 0 },
        GuildBanManager: { maxSize: 0 },
        GuildInviteManager: { maxSize: 0 },
        GuildMemberManager: { maxSize: 0 },
        GuildScheduledEventManager: { maxSize: 0 },
        GuildStickerManager: { maxSize: 0 },
        MessageManager: {
          maxSize: 5,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- with Partials.Message the author can be null at runtime
          keepOverLimit: (message: Message) => message.author?.id === message.client.user.id
        },
        PresenceManager: { maxSize: 0 },
        StageInstanceManager: { maxSize: 0 },
        ThreadManager: { maxSize: 0 },
        ThreadMemberManager: { maxSize: 0 },
        UserManager: { maxSize: 0 }
      }),
      /* eslint-enable @typescript-eslint/naming-convention */
      sweepers: {
        messages: { interval: 300, lifetime: 1800 },
        // eslint-disable-next-line unicorn/no-null -- discord.js sweeper filter requires null to disable user sweeping
        users: { interval: 3600, filter: () => null },
        threads: { interval: 3600, lifetime: 3600 }
      },
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction]
    })

    this.client.on('error', (error: Error) => {
      this.logger.error(error)
    })
    this.client.on('messageDelete', (message) => {
      this.application.core.discordMessagesDeleted([message.id])
    })
    this.client.on('messageDeleteBulk', (messages) => {
      this.application.core.discordMessagesDeleted(messages.map((message) => message.id))
    })

    this.stateHandler = new StateHandler(this)
    this.statusHandler = new StatusHandler(this)
    this.emojiHandler = new EmojiHandler(this)
    this.chatManager = new ChatManager(this, this.messageAssociation)
    this.commandsManager = new CommandManager(this)
    this.loggerManager = new LoggerManager(this)
    this.guildRequirements = new GuildRequirements(this)
    this.statsChannels = new StatsChannels(this)
    this.verificationRoleManager = new VerificationRoleManager(this)
    this.tournamentTestPanel = new TournamentTestPanel(this)
    this.tournamentButtons = new TournamentButtons(this)
    this.tournamentSignup = new TournamentSignup(this)

    this.bridge = new DiscordBridge(
      this.application,
      this,
      this.messageAssociation,
      this.logger,
      this.errorHandler,
      this.staticConfig
    )
  }

  public async profileById(userId: Snowflake, guild: Guild | undefined): Promise<DiscordProfile | undefined> {
    try {
      const user = await this.client.users.fetch(userId)
      const guildMember = guild ? await guild.members.fetch(userId).catch(() => undefined) : undefined
      return this.profileByUser(user, guildMember)
    } catch {
      return undefined
    }
  }

  public profileByUser(user: User, guildMember: GuildMember | undefined): DiscordProfile {
    return {
      id: user.id,
      username: user.username,
      displayName:
        this.cleanUsername(guildMember?.displayName) ??
        this.cleanUsername(user.username) ??
        this.cleanUsername(user.displayName) ??
        user.id,
      avatar: guildMember?.avatarURL() ?? user.avatarURL() ?? undefined
    }
  }

  private cleanUsername(username: string | undefined): string | undefined {
    if (username === undefined) return undefined

    // eslint-disable-next-line no-control-regex
    username = username.replaceAll(/[^\u0000-\u007F]/g, '')

    username = username.trim().slice(0, 16)

    if (/^[\w.-]+$/.test(username)) return username
    if (username.includes(' ')) return username.split(' ')[0]
    return undefined
  }

  public async resolvePermission(userId: string, bridgeId?: string): Promise<Permission> {
    assert.strictEqual(this.currentStatus(), Status.Connected)
    assert.ok(this.client.isReady())

    const cacheKey = `${userId}:${bridgeId ?? ''}`
    const cached = this.permissionCache.get(cacheKey)
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.permission
    }

    if (this.staticConfig.adminIds.includes(userId)) return Permission.Admin

    let highestPermission = Permission.Anyone
    const guildResults = await Promise.allSettled(
      this.client.guilds.cache.map(async (guild) => {
        const guildMember = await guild.members.fetch(userId)
        const permissionLevel = this.resolvePrivilegeLevel(guildMember.roles.cache.keys().toArray(), bridgeId)
        if (guild.ownerId === userId && permissionLevel < Permission.Owner) {
          return Permission.Owner
        }
        return permissionLevel
      })
    )
    for (const result of guildResults) {
      if (result.status === 'fulfilled' && result.value > highestPermission) {
        highestPermission = result.value
      }
    }

    this.permissionCache.set(cacheKey, {
      permission: highestPermission,
      expiresAt: Date.now() + DiscordInstance.PermissionCacheTtl
    })

    if (this.permissionCache.size > DiscordInstance.PermissionCacheMaxSize) {
      const oldestKey = this.permissionCache.keys().next().value
      if (oldestKey !== undefined) this.permissionCache.delete(oldestKey)
    }

    return highestPermission
  }

  private resolvePrivilegeLevel(roles: string[], bridgeId?: string): Permission {
    if (bridgeId === undefined) return Permission.Anyone

    const bridgeConfig = this.application.core.bridgeConfigurations
    if (roles.some((role) => bridgeConfig.getOwnerRoleIds(bridgeId).includes(role))) {
      return Permission.Owner
    }

    if (roles.some((role) => bridgeConfig.getOfficerRoleIds(bridgeId).includes(role))) {
      return Permission.Officer
    }

    if (roles.some((role) => bridgeConfig.getHelperRoleIds(bridgeId).includes(role))) {
      return Permission.Helper
    }

    return Permission.Anyone
  }

  public getClient(): Client {
    return this.client
  }

  public getStaticConfig(): Readonly<StaticDiscordConfig> {
    return this.staticConfig
  }

  async connect(): Promise<void> {
    assert.ok(this.staticConfig.key)

    if (this.connected) {
      this.logger.error('Instance already connected once. Calling connect() again will bug it. Returning...')
      return
    }
    this.connected = true

    await this.setAndBroadcastNewStatus(Status.Connecting)

    this.stateHandler.registerEvents(this.client)
    this.statusHandler.registerEvents(this.client)
    this.emojiHandler.registerEvents(this.client)
    this.chatManager.registerEvents(this.client)
    this.commandsManager.registerEvents(this.client)
    this.loggerManager.registerEvents(this.client)
    this.guildRequirements.registerEvents(this.client)
    this.statsChannels.registerEvents(this.client)
    this.verificationRoleManager.registerEvents(this.client)

    await this.client.login(this.staticConfig.key)
  }

  async disconnect(): Promise<void> {
    this.chatManager.dispose()
    await this.client.destroy()
    await this.setAndBroadcastNewStatus(Status.Ended)
  }
}
