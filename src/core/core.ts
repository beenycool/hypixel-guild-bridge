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

import { AppSettingsManager } from './app-settings'
import { ChatMessagesService } from './chat-messages'
import { CommandsConfigurations } from './commands/commands-configurations'
import { ConfigurationsManager } from './configurations'
import { BridgeConfigurations } from './discord/bridge-configurations'
import { DiscordEmojis } from './discord/discord-emojis'
import { DiscordTemporarilyInteractions } from './discord/discord-temporarily-interactions'
import { InstanceHistoryButton } from './discord/instance-history-button'
import { initializeCoreDatabase } from './initialize-database'
import { StatusHistory } from './instance/status-history'
import { LanguageConfigurations } from './language-configurations'
import { MinecraftAccounts } from './minecraft/minecraft-accounts'
import { SessionsManager } from './minecraft/sessions-manager'
import { ModerationConfigurations } from './moderation/moderation-configurations'
import { Profanity } from './moderation/profanity'
import type { PendingReview, RankupHistoryEntry } from './rankup/pending-review-manager'
import { PendingReviewManager } from './rankup/pending-review-manager'
import { RankupManager } from './rankup/rankup-manager'
import { TournamentManager } from './tournament/tournament-manager.js'
import { TournamentTestPanels } from './tournament/tournament-test-panels.js'
import Autocomplete from './users/autocomplete'
import { GuildManager } from './users/guild-manager'
import { MojangApi } from './users/mojang'
import { Verification } from './users/verification'

export class Core extends Instance<InstanceType.Core> {
  private readonly profanity: Profanity

  private readonly autoComplete: Autocomplete
  public readonly guildManager: GuildManager
  public readonly mojangApi: MojangApi
  public readonly verification: Verification

  public readonly bridgeConfigurations: BridgeConfigurations
  public readonly discordTemporarilyInteractions: DiscordTemporarilyInteractions
  public readonly discordInstanceHistoryButton: InstanceHistoryButton
  public readonly discordEmojis: DiscordEmojis

  public readonly minecraftSessions: SessionsManager
  public readonly moderationConfiguration: ModerationConfigurations
  public readonly minecraftAccounts: MinecraftAccounts

  public readonly statusHistory: StatusHistory
  public readonly pendingReviewManager: PendingReviewManager
  public readonly rankupManager: RankupManager
  public readonly tournamentManager: TournamentManager
  public readonly tournamentTestPanels: TournamentTestPanels

  public readonly languageConfigurations: LanguageConfigurations
  public readonly commandsConfigurations: CommandsConfigurations
  public readonly appSettings: AppSettingsManager

  public readonly chatMessages: ChatMessagesService

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
    this.discordTemporarilyInteractions = new DiscordTemporarilyInteractions(
      this.databaseManager,
      this.bridgeConfigurations
    )
    this.discordInstanceHistoryButton = new InstanceHistoryButton(this.databaseManager)
    this.discordEmojis = new DiscordEmojis(this.databaseManager)

    this.statusHistory = new StatusHistory(this.databaseManager, this.logger)
    this.pendingReviewManager = new PendingReviewManager(this.databaseManager, (type, data) => {
      switch (type) {
        case 'reviewAdded': {
          application
            .emit('pendingReviewAdded', data as Readonly<{ bridgeId: string; review: PendingReview }>)
            .catch((error: unknown) => {
              this.logger.error('Failed to emit pendingReviewAdded event')
              this.logger.error(error)
            })
          break
        }
        case 'reviewRemoved': {
          application
            .emit('pendingReviewRemoved', data as Readonly<{ bridgeId: string; id: number }>)
            .catch((error: unknown) => {
              this.logger.error('Failed to emit pendingReviewRemoved event')
              this.logger.error(error)
            })
          break
        }
        case 'historyAppended': {
          application
            .emit('pendingHistoryAppended', data as Readonly<{ bridgeId: string; entry: RankupHistoryEntry }>)
            .catch((error: unknown) => {
              this.logger.error('Failed to emit pendingHistoryAppended event')
              this.logger.error(error)
            })
          break
        }
      }
    })

    this.languageConfigurations = new LanguageConfigurations(this.configurationsManager)
    this.commandsConfigurations = new CommandsConfigurations(this.configurationsManager)
    this.appSettings = new AppSettingsManager(this.databaseManager, application.config, this.logger)

    this.minecraftSessions = new SessionsManager(this.databaseManager, this.logger)
    this.minecraftAccounts = new MinecraftAccounts(this.databaseManager)

    this.moderationConfiguration = new ModerationConfigurations(this.configurationsManager)
    this.mojangApi = new MojangApi(this.databaseManager)

    this.profanity = new Profanity(this.moderationConfiguration)

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

    this.tournamentManager = new TournamentManager(this.databaseManager, application)
    this.tournamentTestPanels = new TournamentTestPanels(this.databaseManager, this.logger)
    application.addShutdownListener(() => {
      this.tournamentManager.stopScheduler()
    })

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

  private static readonly FilteredMessageTtl = 60_000
  private readonly recentlyFilteredMessages: { message: string; time: number }[] = []

  public recordFilteredMessage(message: string): void {
    this.recentlyFilteredMessages.push({ message, time: Date.now() })
  }

  public isRecentlyFiltered(message: string): boolean {
    const cutoff = Date.now() - Core.FilteredMessageTtl
    let found = false
    for (let index = this.recentlyFilteredMessages.length - 1; index >= 0; index--) {
      const entry = this.recentlyFilteredMessages[index]
      if (entry.time < cutoff) {
        this.recentlyFilteredMessages.splice(index, 1)
      } else if (entry.message === message) {
        found = true
      }
    }
    return found
  }

  public filterProfanityForBridge(
    message: string,
    bridgeId: string | undefined
  ): { filteredMessage: string; changed: boolean } {
    if (bridgeId !== undefined) {
      const bridgeProfanityEnabled = this.bridgeConfigurations.getProfanityEnabled(bridgeId)
      if (bridgeProfanityEnabled === false) {
        return { filteredMessage: message, changed: false }
      }
    }
    return this.profanity.filterProfanity(message)
  }

  public async awaitReady(): Promise<void> {
    await this.ready
  }

  private async initialize(): Promise<void> {
    await initializeCoreDatabase(this.databaseManager)
    await this.configurationsManager.load()
    await this.appSettings.load()
    await this.verification.load()
    await this.mojangApi.load()
    await this.minecraftAccounts.load()
    await this.minecraftSessions.load()
    await this.discordTemporarilyInteractions.load()
    await this.discordEmojis.load()
    await this.statusHistory.load()
    await this.pendingReviewManager.load()
    await this.autoComplete.load()
    await this.tournamentManager.load()
    await this.tournamentTestPanels.load()
    this.tournamentManager.startScheduler()
  }

  public reloadProfanity(): void {
    this.profanity.reloadProfanity()
  }

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

    return new User(this.application, this.userContext(), identifier, undefined, undefined, undefined)
  }

  public discordMessagesDeleted(messagesIds: string[]): void {
    this.discordTemporarilyInteractions.remove(messagesIds)
    this.discordInstanceHistoryButton.remove(messagesIds)
  }

  private userContext(): ManagerContext {
    return {
      moderation: this.moderationConfiguration
    }
  }
}
