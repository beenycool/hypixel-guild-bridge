/*
 * Credit WildWolfsblut <https://github.com/WildWolfsblut>
 * for helping with ./src/core design and structure
 */
import assert from 'node:assert'

import type Application from '../application'
import { InstanceType } from '../common/application-event'
import { DatabaseManager } from '../common/database-manager'
import { Instance, InternalInstancePrefix } from '../common/instance'
import type {
  DiscordProfile,
  DiscordUser,
  InitializeOptions,
  ManagerContext,
  MinecraftUser,
  MojangProfile,
  UserIdentifier
} from '../common/user'
import { User } from '../common/user'

import { ApplicationConfigurations } from './application-configurations'
import { CommandsConfigurations } from './commands/commands-configurations'
import { ConfigurationsManager } from './configurations'
import { BridgeConfigurations } from './discord/bridge-configurations'
import { DiscordConfigurations } from './discord/discord-configurations'
import { DiscordEmojis } from './discord/discord-emojis'
import { DiscordLeaderboards } from './discord/discord-leaderboards'
import { DiscordTemporarilyInteractions } from './discord/discord-temporarily-interactions'
import { InstanceHistoryButton } from './discord/instance-history-button'
import { initializeCoreDatabase } from './initialize-database'
import { DisconnectLogger } from './instance/disconnect-logger'
import { StatusHistory } from './instance/status-history'
import { LanguageConfigurations } from './language-configurations'
import { MinecraftAccounts } from './minecraft/minecraft-accounts'
import { MinecraftConfigurations } from './minecraft/minecraft-configurations'
import { SessionsManager } from './minecraft/sessions-manager'
import { CommandsHeat } from './moderation/commands-heat'
import { ModerationConfigurations } from './moderation/moderation-configurations'
import { Profanity } from './moderation/profanity'
import type { SavedPunishment } from './moderation/punishments'
import Punishments from './moderation/punishments'
import PunishmentsEnforcer from './moderation/punishments-enforcer'
import { PendingReviewManager } from './rankup/pending-review-manager'
import { RankupManager } from './rankup/rankup-manager'
import { SpontaneousEventsConfigurations } from './spontaneous-events-configurations'
import { ChatMessagesService } from './chat-messages'
import Autocomplete from './users/autocomplete'
import { GuildManager } from './users/guild-manager'
import { Inactivity } from './users/inactivity'
import { MojangApi } from './users/mojang'
import ScoresManager from './users/scores-manager'
import { Verification } from './users/verification'

export class Core extends Instance<InstanceType.Core> {
  // moderation
  private readonly commandsHeat: CommandsHeat
  private readonly profanity: Profanity
  private readonly punishments: Punishments
  private readonly enforcer: PunishmentsEnforcer

  // users
  private readonly autoComplete: Autocomplete
  public readonly guildManager: GuildManager
  public readonly mojangApi: MojangApi
  public readonly scoresManager: ScoresManager
  public readonly inactivity: Inactivity
  public readonly verification: Verification

  // discord
  public readonly bridgeConfigurations: BridgeConfigurations
  public readonly discordConfigurations: DiscordConfigurations
  public readonly discordLeaderboards: DiscordLeaderboards
  public readonly discordTemporarilyInteractions: DiscordTemporarilyInteractions
  public readonly discordInstanceHistoryButton: InstanceHistoryButton
  public readonly discordEmojis: DiscordEmojis

  // minecraft
  public readonly minecraftConfigurations: MinecraftConfigurations
  public readonly minecraftSessions: SessionsManager
  public readonly moderationConfiguration: ModerationConfigurations
  public readonly minecraftAccounts: MinecraftAccounts

  // instance
  public readonly disconnectLogger: DisconnectLogger
  public readonly statusHistory: StatusHistory
  public readonly pendingReviewManager: PendingReviewManager
  public readonly rankupManager: RankupManager

  // misc
  public readonly applicationConfigurations: ApplicationConfigurations
  public readonly languageConfigurations: LanguageConfigurations
  public readonly commandsConfigurations: CommandsConfigurations
  public readonly spontaneousEventsConfigurations: SpontaneousEventsConfigurations

  // chat messages
  public readonly chatMessages: ChatMessagesService

  // database
  public readonly databaseManager: DatabaseManager
  private readonly configurationsManager: ConfigurationsManager
  private readonly ready: Promise<void>

  public constructor(application: Application) {
    super(application, InternalInstancePrefix + 'core', InstanceType.Core)

    this.databaseManager = new DatabaseManager(application, this.logger)

    this.configurationsManager = new ConfigurationsManager(this.databaseManager)

    this.bridgeConfigurations = new BridgeConfigurations(this.configurationsManager, (event) => {
      application.emit('bridgeConfigChanged', event).catch((error: unknown) => {
        this.logger.error('Failed to emit bridgeConfigChanged event')
        this.logger.error(error)
      })
    })
    this.discordConfigurations = new DiscordConfigurations(this.configurationsManager)
    this.discordLeaderboards = new DiscordLeaderboards(this.databaseManager)
    this.discordTemporarilyInteractions = new DiscordTemporarilyInteractions(
      this.databaseManager,
      this.discordConfigurations
    )
    this.discordInstanceHistoryButton = new InstanceHistoryButton(this.databaseManager, this.logger)
    this.discordEmojis = new DiscordEmojis(this.databaseManager)

    this.disconnectLogger = new DisconnectLogger(this.databaseManager)
    this.statusHistory = new StatusHistory(this.databaseManager, this.logger)
    this.pendingReviewManager = new PendingReviewManager(this.databaseManager, (type, data) => {
      switch (type) {
        case 'reviewAdded':
          void application.emit('pendingReviewAdded', data as any)
          break
        case 'reviewRemoved':
          void application.emit('pendingReviewRemoved', data as any)
          break
        case 'historyAppended':
          void application.emit('pendingHistoryAppended', data as any)
          break
      }
    })

    this.applicationConfigurations = new ApplicationConfigurations(this.configurationsManager)
    this.languageConfigurations = new LanguageConfigurations(this.configurationsManager)
    this.commandsConfigurations = new CommandsConfigurations(this.configurationsManager)
    this.spontaneousEventsConfigurations = new SpontaneousEventsConfigurations(this.configurationsManager)

    this.minecraftConfigurations = new MinecraftConfigurations(this.configurationsManager)
    this.minecraftSessions = new SessionsManager(this.databaseManager, this.logger)
    this.minecraftAccounts = new MinecraftAccounts(this.databaseManager)

    this.moderationConfiguration = new ModerationConfigurations(this.configurationsManager)
    this.mojangApi = new MojangApi(this.databaseManager)

    this.profanity = new Profanity(this.moderationConfiguration)
    this.punishments = new Punishments(this.databaseManager, application, this.logger)
    this.commandsHeat = new CommandsHeat(this.databaseManager, this.moderationConfiguration, this.logger)
    this.enforcer = new PunishmentsEnforcer(this)

    this.rankupManager = new RankupManager(
      application,
      this.bridgeConfigurations,
      this.pendingReviewManager,
      this.logger
    )

    this.guildManager = new GuildManager(this)
    this.autoComplete = new Autocomplete(this, this.databaseManager)

    this.chatMessages = new ChatMessagesService(application, this.databaseManager)
    this.chatMessages.init()

    this.verification = new Verification(this.databaseManager)
    this.inactivity = new Inactivity(this.databaseManager)
    this.scoresManager = new ScoresManager(this, this.databaseManager)

    this.ready = this.initialize()
  }

  public async completeUsername(query: string, limit: number): Promise<string[]> {
    return await this.autoComplete.username(query, limit)
  }

  public async completeRank(query: string, limit: number): Promise<string[]> {
    return await this.autoComplete.rank(query, limit)
  }

  public filterProfanity(message: string): { filteredMessage: string; changed: boolean } {
    return this.profanity.filterProfanity(message)
  }

  /**
   * Filter profanity for a specific bridge, respecting per-bridge settings
   * @param message The message to filter
   * @param bridgeId Optional bridge ID to check for per-bridge profanity settings
   * @returns The filtered message and whether it was changed
   */
  public filterProfanityForBridge(
    message: string,
    bridgeId: string | undefined
  ): { filteredMessage: string; changed: boolean } {
    // Check per-bridge profanity setting first
    if (bridgeId !== undefined) {
      const bridgeProfanityEnabled = this.bridgeConfigurations.getProfanityEnabled(bridgeId)
      if (bridgeProfanityEnabled === false) {
        return { filteredMessage: message, changed: false }
      }
      // If bridgeProfanityEnabled is true or undefined, fall through to global check
    }
    return this.profanity.filterProfanity(message)
  }

  /**
   * Check if heat punishment is enabled for a specific bridge
   * @param bridgeId Optional bridge ID to check for per-bridge heat punishment settings
   * @returns Whether heat punishment is enabled
   */
  public isHeatPunishmentEnabled(bridgeId: string | undefined): boolean {
    if (bridgeId !== undefined) {
      const bridgeHeatEnabled = this.bridgeConfigurations.getHeatPunishmentEnabled(bridgeId)
      if (bridgeHeatEnabled !== undefined) {
        return bridgeHeatEnabled
      }
    }
    return this.moderationConfiguration.getHeatPunishment()
  }

  /**
   * Get the kicks per day limit for a specific bridge
   * @param bridgeId Optional bridge ID to check for per-bridge setting
   * @returns The kicks per day limit
   */
  public getKicksPerDayForBridge(bridgeId: string | undefined): number {
    if (bridgeId !== undefined) {
      const bridgeLimit = this.bridgeConfigurations.getKicksPerDay(bridgeId)
      if (bridgeLimit !== undefined) {
        return bridgeLimit
      }
    }
    return this.moderationConfiguration.getKicksPerDay()
  }

  /**
   * Get the mutes per day limit for a specific bridge
   * @param bridgeId Optional bridge ID to check for per-bridge setting
   * @returns The mutes per day limit
   */
  public getMutesPerDayForBridge(bridgeId: string | undefined): number {
    if (bridgeId !== undefined) {
      const bridgeLimit = this.bridgeConfigurations.getMutesPerDay(bridgeId)
      if (bridgeLimit !== undefined) {
        return bridgeLimit
      }
    }
    return this.moderationConfiguration.getMutesPerDay()
  }

  public allPunishments(): SavedPunishment[] {
    return this.punishments.all()
  }

  public forgivePunishment(id: number): boolean {
    return this.punishments.removeById(id)
  }

  public async awaitReady(): Promise<void> {
    await this.ready
  }

  private async initialize(): Promise<void> {
    await initializeCoreDatabase(this.databaseManager)
    await this.configurationsManager.load()
    await this.verification.load()
    await this.mojangApi.load()
    await this.minecraftAccounts.load()
    await this.minecraftSessions.load()
    await this.discordLeaderboards.load()
    await this.discordTemporarilyInteractions.load()
    await this.discordEmojis.load()
    await this.statusHistory.load()
    await this.pendingReviewManager.load()
    await this.inactivity.load()
    await this.commandsHeat.load()
    await this.punishments.initialize()
    await this.scoresManager.load()
    await this.autoComplete.load()
  }

  /**
   * @internal Only used by the config managers
   */
  public reloadProfanity(): void {
    this.profanity.reloadProfanity()
  }

  /**
   * Initialize a user based on a given profile and load all metadata in advance
   * @param profile Profile to base the user on
   * @param context additional information that might help with constructing user metadata
   * @returns a full initialized object that contains user data at the moment of execution
   */
  async initializeDiscordUser(
    profile: DiscordProfile,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: InitializeOptions
  ): Promise<DiscordUser> {
    const identifier: UserIdentifier = { userId: profile.id, originInstance: InstanceType.Discord }

    let mojangProfile: MojangProfile | undefined
    const userLink = await this.application.core.verification.findByDiscord(profile.id)
    if (userLink !== undefined) {
      mojangProfile = await this.application.mojangApi.profileByUuid(userLink.uuid)
    }

    const user = new User(this.application, this.userContext(), identifier, mojangProfile, profile, userLink)
    assert.ok(user.isDiscordUser())
    return user
  }

  /**
   * Initialize a user based on a given profile and load all metadata in advance
   * @param mojangProfile Profile to base the user on
   * @param context additional information that might help with constructing user metadata
   * @returns a full initialized object that contains user data at the moment of execution
   */
  async initializeMinecraftUser(mojangProfile: MojangProfile, context: InitializeOptions): Promise<MinecraftUser> {
    const identifier: UserIdentifier = { userId: mojangProfile.id, originInstance: InstanceType.Minecraft }

    let profile: DiscordProfile | undefined
    const userLink = await this.application.core.verification.findByIngame(mojangProfile.id)
    if (userLink !== undefined) {
      profile = await this.application.discordInstance.profileById(userLink.discordId, context.guild)
    }

    const user = new User(this.application, this.userContext(), identifier, mojangProfile, profile, userLink)
    assert.ok(user.isMojangUser())
    return user
  }

  /**
   * Initialize a user based on a given data and load all metadata in advance
   * @param identifier most basic data to identify a unique user
   * @param context additional information that might help with constructing user metadata
   * @returns a full initialized object that contains user data at the moment of execution
   */
  async initializeUser(identifier: UserIdentifier, context: InitializeOptions): Promise<User> {
    switch (identifier.originInstance) {
      case InstanceType.Minecraft: {
        const profile = await this.application.mojangApi.profileByUuid(identifier.userId)
        return this.initializeMinecraftUser(profile, context)
      }
      case InstanceType.Discord: {
        const profile = await this.application.discordInstance.profileById(identifier.userId, context.guild)
        if (profile !== undefined) return this.initializeDiscordUser(profile, context)
      }
    }

    // default
    return new User(this.application, this.userContext(), identifier, undefined, undefined, undefined)
  }

  public discordMessagesDeleted(messagesIds: string[]): void {
    this.discordLeaderboards.remove(messagesIds)
    this.discordTemporarilyInteractions.remove(messagesIds)
    this.discordInstanceHistoryButton.remove(messagesIds)
  }

  private userContext(): ManagerContext {
    return {
      commandsHeat: this.commandsHeat,
      punishments: this.punishments,
      moderation: this.moderationConfiguration
    }
  }
}
