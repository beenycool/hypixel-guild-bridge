import type { DynamicBridgeConfig } from '../../common/dynamic-bridge-config.js'
import Duration from '../../utility/duration'
import type { Configuration, ConfigurationsManager } from '../configurations'

/**
 * Configuration for bridge channel mappings stored in the database.
 * This allows dynamic configuration via /settings command.
 * Each bridge has its own complete set of settings.
 */
export class BridgeConfigurations implements DynamicBridgeConfig {
  private readonly configuration: Configuration
  private readonly onChange?: (event: { bridgeId: string; key: string; value: unknown }) => void

  private getBridgeString(key: string, bridgeId: string, defaultValue = ''): string {
    return this.configuration.getString(`${bridgeId}_${key}`, defaultValue)
  }

  private setBridgeString(key: string, bridgeId: string, value: string | undefined): void {
    const fullKey = `${bridgeId}_${key}`
    if (value === undefined || value === '') {
      this.configuration.delete(fullKey)
    } else {
      this.configuration.setString(fullKey, value)
    }
  }

  constructor(
    manager: ConfigurationsManager,
    onChange?: (event: { bridgeId: string; key: string; value: unknown }) => void
  ) {
    this.configuration = manager.create('bridges')
    this.onChange = onChange
  }

  /**
   * Get all bridge IDs that have been configured dynamically
   */
  public getAllBridgeIds(): string[] {
    return this.configuration.getStringArray('bridgeIds', [])
  }

  /**
   * Add a new bridge ID to the list of bridges
   */
  public addBridgeId(bridgeId: string): void {
    const existing = this.getAllBridgeIds()
    if (!existing.includes(bridgeId)) {
      existing.push(bridgeId)
      this.configuration.setStringArray('bridgeIds', existing)
    }
  }

  private setConfig(bridgeId: string, key: string, value: unknown, apply: () => void): void {
    apply()
    if (this.onChange) {
      try {
        this.onChange({ bridgeId, key, value })
      } catch {
        // ignore errors from callbacks
      }
    }
  }

  /**
   * Remove a bridge ID from the list of bridges
   */
  public removeBridgeId(bridgeId: string): void {
    const existing = this.getAllBridgeIds()
    const filtered = existing.filter((id) => id !== bridgeId)
    this.configuration.setStringArray('bridgeIds', filtered)

    // Clean up all bridge-specific configurations
    this.configuration.delete(`${bridgeId}_publicChannelIds`)
    this.configuration.delete(`${bridgeId}_officerChannelIds`)
    this.configuration.delete(`${bridgeId}_loggerChannelIds`)
    this.configuration.delete(`${bridgeId}_promoteChannelIds`)
    this.configuration.delete(`${bridgeId}_chatSummaryChannelIds`)
    this.configuration.delete(`${bridgeId}_chatSummaryEnabled`)
    this.configuration.delete(`${bridgeId}_minecraftInstances`)
    this.configuration.delete(`${bridgeId}_helperRoleIds`)
    this.configuration.delete(`${bridgeId}_officerRoleIds`)
    this.configuration.delete(`${bridgeId}_ownerRoleIds`)
    this.configuration.delete(`${bridgeId}_joinRequestRoleIds`)

    this.configuration.delete(`${bridgeId}_alwaysReplyReaction`)
    this.configuration.delete(`${bridgeId}_enforceVerification`)
    this.configuration.delete(`${bridgeId}_textToImage`)
    this.configuration.delete(`${bridgeId}_guildOnline`)
    this.configuration.delete(`${bridgeId}_guildOffline`)
    this.configuration.delete(`${bridgeId}_persistGuildOnlineOffline`)
    this.configuration.delete(`${bridgeId}_temporarilyInteractionsCount`)
    this.configuration.delete(`${bridgeId}_temporarilyInteractionsDuration`)
    this.configuration.delete(`${bridgeId}_persistGuildJoinLeave`)
    this.configuration.delete(`${bridgeId}_joinLeaveInteractionsDuration`)
    // Moderation settings
    this.configuration.delete(`${bridgeId}_heatPunishmentEnabled`)
    this.configuration.delete(`${bridgeId}_kicksPerDay`)
    this.configuration.delete(`${bridgeId}_mutesPerDay`)
    this.configuration.delete(`${bridgeId}_profanityEnabled`)
    this.configuration.delete(`${bridgeId}_immuneDiscordUsers`)
    this.configuration.delete(`${bridgeId}_immuneMojangPlayers`)
    // Chat commands settings
    this.configuration.delete(`${bridgeId}_commandsEnabled`)
    this.configuration.delete(`${bridgeId}_commandPrefix`)
    this.configuration.delete(`${bridgeId}_disabledCommands`)
    this.configuration.delete(`${bridgeId}_explainCommandOnHelp`)
    this.configuration.delete(`${bridgeId}_suggestOnTypo`)
    this.configuration.delete(`${bridgeId}_typoSuggestionThreshold`)
    this.configuration.delete(`${bridgeId}_typoCooldownSeconds`)
    this.configuration.delete(`${bridgeId}_insultMode`)

    // Quality of Life settings
    this.configuration.delete(`${bridgeId}_joinGuildReaction`)
    this.configuration.delete(`${bridgeId}_leaveGuildReaction`)
    this.configuration.delete(`${bridgeId}_kickGuildReaction`)

    this.configuration.delete(`${bridgeId}_randomChatterEnabled`)
    this.configuration.delete(`${bridgeId}_randomChatterMessages`)
    this.configuration.delete(`${bridgeId}_randomChatterIntervalMinutes`)
    this.configuration.delete(`${bridgeId}_randomChatterMinimumOnlinePlayers`)
    this.configuration.delete(`${bridgeId}_randomChatterIncludePlayerName`)
    this.configuration.delete(`${bridgeId}_randomChatterAntiRepeatLength`)
    this.configuration.delete(`${bridgeId}_randomChatterQuietWindowMinutes`)
    this.configuration.delete(`${bridgeId}_darkAuctionReminder`)
    this.configuration.delete(`${bridgeId}_starfallCultReminder`)
    this.configuration.delete(`${bridgeId}_announceMutedPlayer`)
    this.configuration.delete(`${bridgeId}_welcomeOnlineEnabled`)
    this.configuration.delete(`${bridgeId}_welcomeOnlineMessages`)

    this.configuration.delete(`${bridgeId}_botUsernameOverride`)
    // Per-bridge language
    this.configuration.delete(`${bridgeId}_language`)
    // Passthrough commands settings
    this.configuration.delete(`${bridgeId}_passthroughCommands`)
    this.configuration.delete(`${bridgeId}_passthroughPrefix`)
    // Rankup automation settings
    this.configuration.delete(`${bridgeId}_rankupEnabled`)
    this.configuration.delete(`${bridgeId}_rankupManualReview`)
    this.configuration.delete(`${bridgeId}_rankupNotificationCooldown`)
    this.configuration.delete(`${bridgeId}_rankupNotificationChannelIds`)
    this.configuration.delete(`${bridgeId}_rankupRules`)
    this.configuration.delete(`${bridgeId}_rankupDemotionRules`)
    this.configuration.delete(`${bridgeId}_rankupExcludedRanks`)
    this.configuration.delete(`${bridgeId}_rankupExcludedPlayers`)

    // Tournament settings
    this.configuration.delete(`${bridgeId}_tournamentEnabled`)
    this.configuration.delete(`${bridgeId}_tournamentNotificationChannelId`)
    this.configuration.delete(`${bridgeId}_tournamentDefaultDeadlineHours`)
    this.configuration.delete(`${bridgeId}_tournamentDefaultBestOf`)
    this.configuration.delete(`${bridgeId}_tournamentAnnounceMc`)
    this.configuration.delete(`${bridgeId}_tournamentDefaultBracketFormat`)
    this.configuration.delete(`${bridgeId}_tournamentValidGameTypes`)

    // Notify listeners that a bridge was removed so utilities can cleanup memory
    if (this.onChange) {
      try {
        this.onChange({ bridgeId, key: 'remove_bridge', value: true })
      } catch {
        // ignore errors from callbacks
      }
    }
  }

  // ========== Channel Configurations ==========

  /**
   * Get public channel IDs for a specific bridge
   */
  public getPublicChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_publicChannelIds`, [])
  }

  /**
   * Set public channel IDs for a specific bridge
   */
  public setPublicChannelIds(bridgeId: string, channelIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_publicChannelIds`, channelIds)
  }

  /**
   * Get officer channel IDs for a specific bridge
   */
  public getOfficerChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_officerChannelIds`, [])
  }

  /**
   * Set officer channel IDs for a specific bridge
   */
  public setOfficerChannelIds(bridgeId: string, channelIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_officerChannelIds`, channelIds)
  }

  /**
   * Get logger channel IDs for a specific bridge
   */
  public getLoggerChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_loggerChannelIds`, [])
  }

  /**
   * Set logger channel IDs for a specific bridge
   */
  public setLoggerChannelIds(bridgeId: string, channelIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_loggerChannelIds`, channelIds)
  }

  /**
   * Get promote channel IDs for a specific bridge
   */
  public getPromoteChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_promoteChannelIds`, [])
  }

  /**
   * Set promote channel IDs for a specific bridge
   */
  public setPromoteChannelIds(bridgeId: string, channelIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_promoteChannelIds`, channelIds)
  }

  /**
   * Get chat summary channel IDs for a specific bridge
   */
  public getChatSummaryChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_chatSummaryChannelIds`, [])
  }

  /**
   * Set chat summary channel IDs for a specific bridge
   */
  public setChatSummaryChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_chatSummaryChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_chatSummaryChannelIds`, channelIds)
    })
  }

  /**
   * Get whether chat summary is enabled for a specific bridge
   */
  public getChatSummaryEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_chatSummaryEnabled`, false)
  }

  /**
   * Set whether chat summary is enabled for a specific bridge
   */
  public setChatSummaryEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_chatSummaryEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_chatSummaryEnabled`, enabled)
    })
  }

  /**
   * Get Minecraft instance names for a specific bridge
   */
  public getMinecraftInstances(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_minecraftInstances`, [])
  }

  /**
   * Set Minecraft instance names for a specific bridge
   */
  public setMinecraftInstances(bridgeId: string, instanceNames: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_minecraftInstances`, instanceNames)
  }

  // ========== Bot Username Override ==========

  /**
   * Get the per-bridge bot username override for Discord image rendering.
   * Returns undefined when no override is set (uses the real bot account name).
   */
  public getBotUsernameOverride(bridgeId: string): string | undefined {
    const value = this.getBridgeString('botUsernameOverride', bridgeId)
    return value === '' ? undefined : value
  }

  /**
   * Set the per-bridge bot username override. Pass undefined or empty string to clear.
   */
  public setBotUsernameOverride(bridgeId: string, name: string | undefined): void {
    this.setBridgeString('botUsernameOverride', bridgeId, name)
  }

  // ========== Language Configuration ==========

  /**
   * Get the configured language for a specific bridge (e.g., 'en', 'de', 'ar').
   * Returns undefined when no per-bridge language is set.
   */
  public getLanguage(bridgeId: string): string | undefined {
    const value = this.getBridgeString('language', bridgeId)
    return value === '' ? undefined : value
  }

  /**
   * Set the configured language for a specific bridge. Pass undefined to clear the setting.
   */
  public setLanguage(bridgeId: string, language: string | undefined): void {
    this.setBridgeString('language', bridgeId, language)
  }

  /**
   * Get the Hypixel guild name for a specific bridge.
   * Resolved on startup from the bot's guild membership.
   */
  public getGuildName(bridgeId: string): string | undefined {
    const value = this.getBridgeString('guildName', bridgeId)
    return value === '' ? undefined : value
  }

  /**
   * Set the Hypixel guild name for a specific bridge.
   */
  public setGuildName(bridgeId: string, name: string | undefined): void {
    this.setBridgeString('guildName', bridgeId, name)
  }

  // ========== Role Configurations ==========

  /**
   * Get helper role IDs for a specific bridge
   */
  public getHelperRoleIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_helperRoleIds`, [])
  }

  /**
   * Set helper role IDs for a specific bridge
   */
  public setHelperRoleIds(bridgeId: string, roleIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_helperRoleIds`, roleIds)
  }

  /**
   * Get officer role IDs for a specific bridge
   */
  public getOfficerRoleIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_officerRoleIds`, [])
  }

  /**
   * Set officer role IDs for a specific bridge
   */
  public setOfficerRoleIds(bridgeId: string, roleIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_officerRoleIds`, roleIds)
  }

  /**
   * Get owner role IDs for a specific bridge
   */
  public getOwnerRoleIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_ownerRoleIds`, [])
  }

  /**
   * Set owner role IDs for a specific bridge
   */
  public setOwnerRoleIds(bridgeId: string, roleIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_ownerRoleIds`, roleIds)
  }

  /**
   * Get join request role IDs for a specific bridge
   */
  public getJoinRequestRoleIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_joinRequestRoleIds`, [])
  }

  /**
   * Set join request role IDs for a specific bridge
   */
  public setJoinRequestRoleIds(bridgeId: string, roleIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_joinRequestRoleIds`, roleIds)
  }

  // ========== Discord Settings ==========

  /**
   * Get always reply reaction setting for a specific bridge
   */
  public getAlwaysReplyReaction(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_alwaysReplyReaction`, false)
  }

  /**
   * Set always reply reaction setting for a specific bridge
   */
  public setAlwaysReplyReaction(bridgeId: string, value: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_alwaysReplyReaction`, value)
  }

  /**
   * Get enforce verification setting for a specific bridge
   */
  public getEnforceVerification(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_enforceVerification`, false)
  }

  /**
   * Set enforce verification setting for a specific bridge
   */
  public setEnforceVerification(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_enforceVerification`, enabled)
  }

  /**
   * Get text to image setting for a specific bridge
   */
  public getTextToImage(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_textToImage`, false)
  }

  /**
   * Set text to image setting for a specific bridge
   */
  public setTextToImage(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_textToImage`, enabled)
  }

  /**
   * Get guild online notification setting for a specific bridge
   */
  public getGuildOnline(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_guildOnline`, true)
  }

  /**
   * Set guild online notification setting for a specific bridge
   */
  public setGuildOnline(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_guildOnline`, enabled)
  }

  /**
   * Get guild offline notification setting for a specific bridge
   */
  public getGuildOffline(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_guildOffline`, true)
  }

  /**
   * Set guild offline notification setting for a specific bridge
   */
  public setGuildOffline(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_guildOffline`, enabled)
  }

  /**
   * Get persist guild online/offline setting for a specific bridge
   */
  public getPersistGuildOnlineOffline(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_persistGuildOnlineOffline`, false)
  }

  /**
   * Set persist guild online/offline setting for a specific bridge
   */
  public setPersistGuildOnlineOffline(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_persistGuildOnlineOffline`, enabled)
  }

  /**
   * Get max temporarily interactions for a specific bridge
   */
  public getMaxTemporarilyInteractions(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_temporarilyInteractionsCount`, 5)
  }

  /**
   * Set max temporarily interactions for a specific bridge
   */
  public setMaxTemporarilyInteractions(bridgeId: string, value: number): void {
    this.configuration.setNumber(`${bridgeId}_temporarilyInteractionsCount`, value)
  }

  /**
   * Get duration for temporarily interactions for a specific bridge
   */
  public getDurationTemporarilyInteractions(bridgeId: string): Duration {
    const value = this.configuration.getNumber(
      `${bridgeId}_temporarilyInteractionsDuration`,
      Duration.minutes(15).toSeconds()
    )
    return Duration.seconds(value)
  }

  /**
   * Set duration for temporarily interactions for a specific bridge
   */
  public setDurationTemporarilyInteractions(bridgeId: string, value: Duration): void {
    this.configuration.setNumber(`${bridgeId}_temporarilyInteractionsDuration`, value.toSeconds())
  }

  public getPersistGuildJoinLeave(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_persistGuildJoinLeave`, false)
  }

  public setPersistGuildJoinLeave(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_persistGuildJoinLeave`, enabled)
  }

  public getDurationJoinLeaveInteractions(bridgeId: string): Duration {
    const value = this.configuration.getNumber(
      `${bridgeId}_joinLeaveInteractionsDuration`,
      Duration.days(2).toSeconds()
    )
    return Duration.seconds(value)
  }

  public setDurationJoinLeaveInteractions(bridgeId: string, value: Duration): void {
    this.configuration.setNumber(`${bridgeId}_joinLeaveInteractionsDuration`, value.toSeconds())
  }

  // ========== Moderation Configurations ==========

  /**
   * Get whether heat punishment is enabled for a specific bridge (undefined = use global)
   */
  public getHeatPunishmentEnabled(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('heatPunishmentEnabled', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  /**
   * Set whether heat punishment is enabled for a specific bridge
   */
  public setHeatPunishmentEnabled(bridgeId: string, enabled: boolean | undefined): void {
    if (enabled === undefined) {
      this.configuration.delete(`${bridgeId}_heatPunishmentEnabled`)
    } else {
      this.configuration.setString(`${bridgeId}_heatPunishmentEnabled`, enabled ? 'true' : 'false')
    }
  }

  /**
   * Get kicks per day for a specific bridge (undefined = use global)
   */
  public getKicksPerDay(bridgeId: string): number | undefined {
    const value = this.configuration.getNumber(`${bridgeId}_kicksPerDay`, -1)
    return value === -1 ? undefined : value
  }

  /**
   * Set kicks per day for a specific bridge
   */
  public setKicksPerDay(bridgeId: string, value: number | undefined): void {
    if (value === undefined) {
      this.configuration.delete(`${bridgeId}_kicksPerDay`)
    } else {
      this.configuration.setNumber(`${bridgeId}_kicksPerDay`, value)
    }
  }

  /**
   * Get mutes per day for a specific bridge (undefined = use global)
   */
  public getMutesPerDay(bridgeId: string): number | undefined {
    const value = this.configuration.getNumber(`${bridgeId}_mutesPerDay`, -1)
    return value === -1 ? undefined : value
  }

  /**
   * Set mutes per day for a specific bridge
   */
  public setMutesPerDay(bridgeId: string, value: number | undefined): void {
    if (value === undefined) {
      this.configuration.delete(`${bridgeId}_mutesPerDay`)
    } else {
      this.configuration.setNumber(`${bridgeId}_mutesPerDay`, value)
    }
  }

  /**
   * Get whether profanity filter is enabled for a specific bridge (undefined = use global)
   */
  public getProfanityEnabled(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('profanityEnabled', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  /**
   * Set whether profanity filter is enabled for a specific bridge
   */
  public setProfanityEnabled(bridgeId: string, enabled: boolean | undefined): void {
    if (enabled === undefined) {
      this.configuration.delete(`${bridgeId}_profanityEnabled`)
    } else {
      this.configuration.setString(`${bridgeId}_profanityEnabled`, enabled ? 'true' : 'false')
    }
  }

  /**
   * Get immune Discord users for a specific bridge
   */
  public getImmuneDiscordUsers(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_immuneDiscordUsers`, [])
  }

  /**
   * Set immune Discord users for a specific bridge
   */
  public setImmuneDiscordUsers(bridgeId: string, users: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_immuneDiscordUsers`, users)
  }

  /**
   * Get immune Mojang players for a specific bridge
   */
  public getImmuneMojangPlayers(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_immuneMojangPlayers`, [])
  }

  /**
   * Set immune Mojang players for a specific bridge
   */
  public setImmuneMojangPlayers(bridgeId: string, players: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_immuneMojangPlayers`, players)
  }

  // ========== Chat Commands Configurations ==========

  /**
   * Get whether chat commands are enabled for a specific bridge (undefined = use global)
   */
  public getCommandsEnabled(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('commandsEnabled', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  /**
   * Set whether chat commands are enabled for a specific bridge
   */
  public setCommandsEnabled(bridgeId: string, enabled: boolean | undefined): void {
    if (enabled === undefined) {
      this.configuration.delete(`${bridgeId}_commandsEnabled`)
    } else {
      this.configuration.setString(`${bridgeId}_commandsEnabled`, enabled ? 'true' : 'false')
    }
  }

  /**
   * Get chat command prefix for a specific bridge (undefined = use global)
   */
  public getCommandPrefix(bridgeId: string): string | undefined {
    const value = this.getBridgeString('commandPrefix', bridgeId)
    return value === '' ? undefined : value
  }

  /**
   * Set chat command prefix for a specific bridge
   */
  public setCommandPrefix(bridgeId: string, prefix: string | undefined): void {
    this.setBridgeString('commandPrefix', bridgeId, prefix)
  }

  /**
   * Get disabled commands for a specific bridge
   */
  public getDisabledCommands(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_disabledCommands`, [])
  }

  /**
   * Set disabled commands for a specific bridge
   */
  public setDisabledCommands(bridgeId: string, commands: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_disabledCommands`, commands)
  }

  /**
   * Get whether command explanation on help is enabled for a specific bridge (undefined = use global)
   */
  public getExplainCommandOnHelp(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('explainCommandOnHelp', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  /**
   * Set whether command explanation on help is enabled for a specific bridge
   */
  public setExplainCommandOnHelp(bridgeId: string, enabled: boolean | undefined): void {
    if (enabled === undefined) {
      this.configuration.delete(`${bridgeId}_explainCommandOnHelp`)
    } else {
      this.configuration.setString(`${bridgeId}_explainCommandOnHelp`, enabled ? 'true' : 'false')
    }
  }

  /**
   * Get whether typo suggestion is enabled for a specific bridge (undefined = use global)
   */
  public getSuggestOnTypo(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('suggestOnTypo', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  /**
   * Set whether typo suggestion is enabled for a specific bridge
   */
  public setSuggestOnTypo(bridgeId: string, enabled: boolean | undefined): void {
    if (enabled === undefined) {
      this.configuration.delete(`${bridgeId}_suggestOnTypo`)
    } else {
      this.configuration.setString(`${bridgeId}_suggestOnTypo`, enabled ? 'true' : 'false')
    }
  }

  /**
   * Get typo suggestion threshold for a specific bridge (undefined = use global)
   */
  public getTypoSuggestionThreshold(bridgeId: string): number | undefined {
    const value = this.configuration.getNumber(`${bridgeId}_typoSuggestionThreshold`, -1)
    return value === -1 ? undefined : value
  }

  /**
   * Set typo suggestion threshold for a specific bridge
   */
  public setTypoSuggestionThreshold(bridgeId: string, threshold: number | undefined): void {
    if (threshold === undefined) {
      this.configuration.delete(`${bridgeId}_typoSuggestionThreshold`)
    } else {
      this.configuration.setNumber(`${bridgeId}_typoSuggestionThreshold`, threshold)
    }
  }

  /**
   * Get typo cooldown seconds for a specific bridge (undefined = use global)
   */
  public getTypoCooldownSeconds(bridgeId: string): number | undefined {
    const value = this.configuration.getNumber(`${bridgeId}_typoCooldownSeconds`, -1)
    return value === -1 ? undefined : value
  }

  /**
   * Set typo cooldown seconds for a specific bridge
   */
  public setTypoCooldownSeconds(bridgeId: string, seconds: number | undefined): void {
    if (seconds === undefined) {
      this.configuration.delete(`${bridgeId}_typoCooldownSeconds`)
    } else {
      this.configuration.setNumber(`${bridgeId}_typoCooldownSeconds`, seconds)
    }
  }

  /**
   * Get insult mode for a specific bridge ('normal', 'custom', or undefined = use global default)
   */
  public getInsultMode(bridgeId: string): string | undefined {
    const value = this.getBridgeString('insultMode', bridgeId)
    return value === '' ? undefined : value
  }

  /**
   * Set insult mode for a specific bridge. Pass undefined to clear the setting.
   */
  public setInsultMode(bridgeId: string, mode: string | undefined): void {
    this.setBridgeString('insultMode', bridgeId, mode)
  }

  // ========== Quality of Life Configurations ==========

  public getJoinGuildReaction(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_joinGuildReaction`, true)
  }

  public setJoinGuildReaction(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_joinGuildReaction`, enabled)
  }

  public getLeaveGuildReaction(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_leaveGuildReaction`, true)
  }

  public setLeaveGuildReaction(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_leaveGuildReaction`, enabled)
  }

  public getKickGuildReaction(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_kickGuildReaction`, true)
  }

  public setKickGuildReaction(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_kickGuildReaction`, enabled)
  }

  public getJoinReactionEmojiType(bridgeId: string): string {
    return this.configuration.getString(`${bridgeId}_joinReactionEmojiType`, 'none')
  }

  public setJoinReactionEmojiType(bridgeId: string, value: string): void {
    this.configuration.setString(`${bridgeId}_joinReactionEmojiType`, value)
  }

  public getLeaveReactionEmojiType(bridgeId: string): string {
    return this.configuration.getString(`${bridgeId}_leaveReactionEmojiType`, 'none')
  }

  public setLeaveReactionEmojiType(bridgeId: string, value: string): void {
    this.configuration.setString(`${bridgeId}_leaveReactionEmojiType`, value)
  }

  // ========== Random Chatter Configurations ==========

  public getRandomChatterEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_randomChatterEnabled`, false)
  }

  public setRandomChatterEnabled(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_randomChatterEnabled`, enabled)
  }

  public getRandomChatterMessages(bridgeId: string, defaultMessages: string[]): string[] {
    return this.configuration.getStringArray(`${bridgeId}_randomChatterMessages`, defaultMessages)
  }

  public setRandomChatterMessages(bridgeId: string, messages: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_randomChatterMessages`, messages)
  }

  public getRandomChatterIntervalMinutes(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_randomChatterIntervalMinutes`, 15)
  }

  public setRandomChatterIntervalMinutes(bridgeId: string, minutes: number): void {
    // Clamp and validate to avoid non-sensical values
    const normalized = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 15
    this.configuration.setNumber(`${bridgeId}_randomChatterIntervalMinutes`, normalized)
  }

  public getRandomChatterMinimumOnlinePlayers(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_randomChatterMinimumOnlinePlayers`, 1)
  }

  public setRandomChatterMinimumOnlinePlayers(bridgeId: string, count: number): void {
    // Enforce a minimum of 1 so zero cannot bypass the online-members check
    const normalized = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1
    this.configuration.setNumber(`${bridgeId}_randomChatterMinimumOnlinePlayers`, normalized)
  }

  public getRandomChatterIncludePlayerName(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_randomChatterIncludePlayerName`, true)
  }

  public setRandomChatterIncludePlayerName(bridgeId: string, include: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_randomChatterIncludePlayerName`, include)
  }

  public getRandomChatterAntiRepeatLength(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_randomChatterAntiRepeatLength`, 5)
  }

  public setRandomChatterAntiRepeatLength(bridgeId: string, length: number): void {
    const normalized = Number.isFinite(length) && length >= 0 ? Math.floor(length) : 5
    const clamped = Math.min(normalized, 50)
    this.configuration.setNumber(`${bridgeId}_randomChatterAntiRepeatLength`, clamped)
  }

  public getRandomChatterQuietWindowMinutes(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_randomChatterQuietWindowMinutes`, 2)
  }

  public setRandomChatterQuietWindowMinutes(bridgeId: string, minutes: number): void {
    const normalized = Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : 2
    const clamped = Math.min(normalized, 60)
    this.configuration.setNumber(`${bridgeId}_randomChatterQuietWindowMinutes`, clamped)
  }

  public getAnnounceMutedPlayer(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_announceMutedPlayer`, true)
  }

  public setAnnounceMutedPlayer(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_announceMutedPlayer`, enabled)
  }

  public getWelcomeOnlineEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_welcomeOnlineEnabled`, false)
  }

  public setWelcomeOnlineEnabled(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_welcomeOnlineEnabled`, enabled)
  }

  public getWelcomeOnlineMessages(bridgeId: string): { uuid: string; message: string }[] {
    const raw = this.configuration.getString(`${bridgeId}_welcomeOnlineMessages`, '[]')
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  public setWelcomeOnlineMessages(bridgeId: string, messages: { uuid: string; message: string }[]): void {
    this.configuration.setString(`${bridgeId}_welcomeOnlineMessages`, JSON.stringify(messages))
  }

  // ========== Passthrough Commands Configurations ==========

  /**
   * Get passthrough commands for a specific bridge.
   * These commands are forwarded directly to in-game chat without the bridge prefix.
   * Returns empty array if not configured (falls back to global).
   */
  public getPassthroughCommands(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_passthroughCommands`, [])
  }

  /**
   * Set passthrough commands for a specific bridge
   */
  public setPassthroughCommands(bridgeId: string, commands: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_passthroughCommands`, commands)
  }

  /**
   * Get passthrough prefix for a specific bridge (undefined = use global)
   */
  public getPassthroughPrefix(bridgeId: string): string | undefined {
    const value = this.getBridgeString('passthroughPrefix', bridgeId)
    return value === '' ? undefined : value
  }

  /**
   * Set passthrough prefix for a specific bridge
   */
  public setPassthroughPrefix(bridgeId: string, prefix: string | undefined): void {
    this.setBridgeString('passthroughPrefix', bridgeId, prefix)
  }

  // ========== Rankup Automation Configurations ==========

  /**
   * Get whether rankup automation is enabled for a bridge
   */
  public getRankupEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_rankupEnabled`, false)
  }

  /**
   * Set whether rankup automation is enabled for a bridge
   */
  public setRankupEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_rankupEnabled`, enabled)
    })
  }

  /**
   * Get whether manual review mode is enabled for rankup
   */
  public getRankupManualReview(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_rankupManualReview`, false)
  }

  /**
   * Set whether manual review mode is enabled for rankup
   */
  public setRankupManualReview(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupManualReview`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_rankupManualReview`, enabled)
    })
  }

  /**
   * Get notification cooldown in hours for rankup
   */
  public getRankupNotificationCooldown(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_rankupNotificationCooldown`, 24)
  }

  /**
   * Set notification cooldown in hours for rankup
   */
  public setRankupNotificationCooldown(bridgeId: string, hours: number): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupNotificationCooldown`, hours, () => {
      this.configuration.setNumber(`${bridgeId}_rankupNotificationCooldown`, hours)
    })
  }

  /**
   * Get notification channel IDs for rankup
   */
  public getRankupNotificationChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_rankupNotificationChannelIds`, [])
  }

  /**
   * Set notification channel IDs for rankup
   */
  public setRankupNotificationChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupNotificationChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_rankupNotificationChannelIds`, channelIds)
    })
  }

  /**
   * Get the day of the week the rankup check is restricted to (0=Sunday..6=Saturday, -1 = no restriction)
   */
  public getRankupScheduleDay(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_rankupScheduleDay`, -1)
  }

  /**
   * Set the day of the week the rankup check is restricted to (0=Sunday..6=Saturday)
   */
  public setRankupScheduleDay(bridgeId: string, day: number): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupScheduleDay`, day, () => {
      this.configuration.setNumber(`${bridgeId}_rankupScheduleDay`, day)
    })
  }

  /**
   * Get the hour (UK time, 0-23) the rankup check is restricted to (-1 = no restriction)
   */
  public getRankupScheduleHour(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_rankupScheduleHour`, -1)
  }

  /**
   * Set the hour (UK time, 0-23) the rankup check is restricted to
   */
  public setRankupScheduleHour(bridgeId: string, hour: number): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupScheduleHour`, hour, () => {
      this.configuration.setNumber(`${bridgeId}_rankupScheduleHour`, hour)
    })
  }

  /**
   * Get promotion rules for rankup
   */
  public getRankupRules(bridgeId: string): {
    targetRank: string
    minWeeklyGexp: number
    minDaysInGuild: number
    minOnlineHours: number
  }[] {
    const raw = this.configuration.getString(`${bridgeId}_rankupRules`, '[]')
    try {
      return JSON.parse(raw) as {
        targetRank: string
        minWeeklyGexp: number
        minDaysInGuild: number
        minOnlineHours: number
      }[]
    } catch {
      return []
    }
  }

  /**
   * Set promotion rules for rankup
   */
  public setRankupRules(
    bridgeId: string,
    rules: {
      targetRank: string
      minWeeklyGexp: number
      minDaysInGuild: number
      minOnlineHours: number
    }[]
  ): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupRules`, rules, () => {
      this.configuration.setString(`${bridgeId}_rankupRules`, JSON.stringify(rules))
    })
  }

  /**
   * Get demotion rules for rankup
   */
  public getRankupDemotionRules(bridgeId: string): {
    fromRank: string
    action: 'demote' | 'kick' | 'notify'
    targetRank?: string
    maxWeeklyGexp: number
    gracePeriod: number
    maxDaysInactive?: number
  }[] {
    const raw = this.configuration.getString(`${bridgeId}_rankupDemotionRules`, '[]')
    try {
      return JSON.parse(raw) as {
        fromRank: string
        action: 'demote' | 'kick' | 'notify'
        targetRank?: string
        maxWeeklyGexp: number
        gracePeriod: number
        maxDaysInactive?: number
      }[]
    } catch {
      return []
    }
  }

  /**
   * Set demotion rules for rankup
   */
  public setRankupDemotionRules(
    bridgeId: string,
    rules: {
      fromRank: string
      action: 'demote' | 'kick' | 'notify'
      targetRank?: string
      maxWeeklyGexp: number
      gracePeriod: number
      maxDaysInactive?: number
    }[]
  ): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupDemotionRules`, rules, () => {
      this.configuration.setString(`${bridgeId}_rankupDemotionRules`, JSON.stringify(rules))
    })
  }

  /**
   * Get excluded ranks for rankup automation
   */
  public getRankupExcludedRanks(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_rankupExcludedRanks`, [])
  }

  /**
   * Set excluded ranks for rankup automation
   */
  public setRankupExcludedRanks(bridgeId: string, ranks: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupExcludedRanks`, ranks, () => {
      this.configuration.setStringArray(`${bridgeId}_rankupExcludedRanks`, ranks)
    })
  }

  /**
   * Get excluded players for rankup automation
   */
  public getRankupExcludedPlayers(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_rankupExcludedPlayers`, [])
  }

  /**
   * Set excluded players for rankup automation
   */
  public setRankupExcludedPlayers(bridgeId: string, players: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupExcludedPlayers`, players, () => {
      this.configuration.setStringArray(`${bridgeId}_rankupExcludedPlayers`, players)
    })
  }

  // ========== Tournament Configurations ==========

  /**
   * Get whether tournament system is enabled for a bridge
   */
  public getTournamentEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_tournamentEnabled`, false)
  }

  /**
   * Set whether tournament system is enabled for a bridge
   */
  public setTournamentEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_tournamentEnabled`, enabled)
    })
  }

  /**
   * Get tournament notification channel ID for a bridge
   */
  public getTournamentNotificationChannelId(bridgeId: string): string {
    return this.configuration.getString(`${bridgeId}_tournamentNotificationChannelId`, '')
  }

  /**
   * Set tournament notification channel ID for a bridge
   */
  public setTournamentNotificationChannelId(bridgeId: string, channelId: string): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentNotificationChannelId`, channelId, () => {
      this.configuration.setString(`${bridgeId}_tournamentNotificationChannelId`, channelId)
    })
  }

  /**
   * Get default deadline in hours for tournament rounds
   */
  public getTournamentDefaultDeadlineHours(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_tournamentDefaultDeadlineHours`, 48)
  }

  /**
   * Set default deadline in hours for tournament rounds
   */
  public setTournamentDefaultDeadlineHours(bridgeId: string, hours: number): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentDefaultDeadlineHours`, hours, () => {
      this.configuration.setNumber(`${bridgeId}_tournamentDefaultDeadlineHours`, hours)
    })
  }

  /**
   * Get default bestOf (series count) for a bridge
   */
  public getTournamentDefaultBestOf(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_tournamentDefaultBestOf`, 1)
  }

  /**
   * Set default bestOf (series count) for a bridge
   */
  public setTournamentDefaultBestOf(bridgeId: string, bestOf: number): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentDefaultBestOf`, bestOf, () => {
      this.configuration.setNumber(`${bridgeId}_tournamentDefaultBestOf`, bestOf)
    })
  }

  /**
   * Get whether to announce tournaments in MC whispers/chat
   */
  public getTournamentAnnounceMc(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_tournamentAnnounceMc`, true)
  }

  /**
   * Set whether to announce tournaments in MC whispers/chat
   */
  public setTournamentAnnounceMc(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentAnnounceMc`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_tournamentAnnounceMc`, enabled)
    })
  }

  public getTournamentCheckinWindowMinutes(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_tournamentCheckinWindowMinutes`, 60)
  }

  public setTournamentCheckinWindowMinutes(bridgeId: string, minutes: number): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentCheckinWindowMinutes`, minutes, () => {
      this.configuration.setNumber(`${bridgeId}_tournamentCheckinWindowMinutes`, minutes)
    })
  }

  public getTournamentMinParticipants(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_tournamentMinParticipants`, 4)
  }

  public setTournamentMinParticipants(bridgeId: string, count: number): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentMinParticipants`, count, () => {
      this.configuration.setNumber(`${bridgeId}_tournamentMinParticipants`, count)
    })
  }

  public getTournamentMaxExtensionHours(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_tournamentMaxExtensionHours`, 24)
  }

  public setTournamentMaxExtensionHours(bridgeId: string, hours: number): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentMaxExtensionHours`, hours, () => {
      this.configuration.setNumber(`${bridgeId}_tournamentMaxExtensionHours`, hours)
    })
  }

  public getTournamentAutoCheckin(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_tournamentAutoCheckin`, true)
  }

  public setTournamentAutoCheckin(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentAutoCheckin`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_tournamentAutoCheckin`, enabled)
    })
  }

  public getTournamentCategoryId(bridgeId: string): string | undefined {
    const value = this.configuration.getString(`${bridgeId}_tournamentCategoryId`, '')
    return value === '' ? undefined : value
  }

  public setTournamentCategoryId(bridgeId: string, categoryId: string | undefined): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentCategoryId`, categoryId, () => {
      if (categoryId === undefined) {
        this.configuration.delete(`${bridgeId}_tournamentCategoryId`)
      } else {
        this.configuration.setString(`${bridgeId}_tournamentCategoryId`, categoryId)
      }
    })
  }

  public getTournamentDefaultBracketFormat(bridgeId: string): string {
    return this.configuration.getString(`${bridgeId}_tournamentDefaultBracketFormat`, 'single-elim')
  }

  public setTournamentDefaultBracketFormat(bridgeId: string, format: string): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentDefaultBracketFormat`, format, () => {
      this.configuration.setString(`${bridgeId}_tournamentDefaultBracketFormat`, format)
    })
  }

  public getTournamentValidGameTypes(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_tournamentValidGameTypes`, [])
  }

  public setTournamentValidGameTypes(bridgeId: string, types: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentValidGameTypes`, types, () => {
      this.configuration.setStringArray(`${bridgeId}_tournamentValidGameTypes`, types)
    })
  }

  public getTranslationOverrides(bridgeId: string): Record<string, string> {
    const raw = this.configuration.getString(`${bridgeId}_translationOverrides`, '{}')
    try {
      return JSON.parse(raw) as Record<string, string>
    } catch {
      return {}
    }
  }

  public setTranslationOverrides(bridgeId: string, overrides: Record<string, string>): void {
    this.configuration.setString(`${bridgeId}_translationOverrides`, JSON.stringify(overrides))
  }

  // ========== Bulk settings reader ==========

  public getAllSettings(bridgeId: string): Record<string, unknown> {
    const channels = this.getPublicChannelIds(bridgeId)
    const officerChannels = this.getOfficerChannelIds(bridgeId)
    const loggerChannels = this.getLoggerChannelIds(bridgeId)

    return {
      channels: {
        publicChannelIds: channels,
        officerChannelIds: officerChannels,
        loggerChannelIds: loggerChannels,
        promoteChannelIds: this.getPromoteChannelIds(bridgeId),
        chatSummaryChannelIds: this.getChatSummaryChannelIds(bridgeId),
        chatSummaryEnabled: this.getChatSummaryEnabled(bridgeId)
      },
      instances: {
        minecraftInstances: this.getMinecraftInstances(bridgeId)
      },
      staffRoles: {
        helperRoleIds: this.getHelperRoleIds(bridgeId),
        officerRoleIds: this.getOfficerRoleIds(bridgeId),
        ownerRoleIds: this.getOwnerRoleIds(bridgeId),
        joinRequestRoleIds: this.getJoinRequestRoleIds(bridgeId)
      },
      discordSettings: {
        alwaysReply: this.getAlwaysReplyReaction(bridgeId),
        enforceVerification: this.getEnforceVerification(bridgeId),
        minecraftTextImages: this.getTextToImage(bridgeId),
        language: this.getLanguage(bridgeId) ?? '',
        botUsernameOverride: this.getBotUsernameOverride(bridgeId) ?? ''
      },
      minecraftEvents: {
        memberOnline: this.getGuildOnline(bridgeId),
        memberOffline: this.getGuildOffline(bridgeId),
        persistOnlineOffline: this.getPersistGuildOnlineOffline(bridgeId),
        deleteAfterSeconds: this.getDurationTemporarilyInteractions(bridgeId).toSeconds(),
        maxEvents: this.getMaxTemporarilyInteractions(bridgeId),
        persistJoinLeave: this.getPersistGuildJoinLeave(bridgeId),
        deleteJoinLeaveAfterSeconds: this.getDurationJoinLeaveInteractions(bridgeId).toSeconds(),
        chatterEnabled: this.getRandomChatterEnabled(bridgeId),
        chatterIntervalMinutes: this.getRandomChatterIntervalMinutes(bridgeId),
        chatterMinOnlinePlayers: this.getRandomChatterMinimumOnlinePlayers(bridgeId),
        chatterUseBotName: this.getRandomChatterIncludePlayerName(bridgeId),
        chatterMessages: this.getRandomChatterMessages(bridgeId, []),
        chatterAntiRepeatLength: this.getRandomChatterAntiRepeatLength(bridgeId),
        chatterQuietWindowMinutes: this.getRandomChatterQuietWindowMinutes(bridgeId),
        welcomeOnlineEnabled: this.getWelcomeOnlineEnabled(bridgeId),
        welcomeOnlineMessages: this.getWelcomeOnlineMessages(bridgeId)
      },
      qualityOfLife: {
        guildJoinReaction: this.getJoinGuildReaction(bridgeId),
        guildLeaveReaction: this.getLeaveGuildReaction(bridgeId),
        guildKickReaction: this.getKickGuildReaction(bridgeId),
        joinDiscordReaction: this.getJoinReactionEmojiType(bridgeId),
        leaveDiscordReaction: this.getLeaveReactionEmojiType(bridgeId),
        announcePlayerMuted: this.getAnnounceMutedPlayer(bridgeId)
      },
      translations: {
        overrides: this.getTranslationOverrides(bridgeId)
      },
      moderation: {
        heatPunishmentsEnabled: this.getHeatPunishmentEnabled(bridgeId),
        heatKicksPerDay: this.getKicksPerDay(bridgeId),
        heatMutesPerDay: this.getMutesPerDay(bridgeId),
        immuneDiscordUserIds: this.getImmuneDiscordUsers(bridgeId),
        immuneMojangPlayers: this.getImmuneMojangPlayers(bridgeId),
        profanityFilterEnabled: this.getProfanityEnabled(bridgeId)
      },
      chatCommands: {
        commandsEnabled: this.getCommandsEnabled(bridgeId),
        chatCommandPrefix: this.getCommandPrefix(bridgeId) ?? '',
        passthroughPrefix: this.getPassthroughPrefix(bridgeId) ?? '',
        passthroughCommands: this.getPassthroughCommands(bridgeId),
        insultMode: this.getInsultMode(bridgeId) ?? ''
      },
      rankup: {
        enabled: this.getRankupEnabled(bridgeId),
        manualReview: this.getRankupManualReview(bridgeId),
        notificationCooldown: this.getRankupNotificationCooldown(bridgeId),
        notificationChannelIds: this.getRankupNotificationChannelIds(bridgeId),
        scheduleDay: this.getRankupScheduleDay(bridgeId),
        scheduleHour: this.getRankupScheduleHour(bridgeId),
        promotionRules: this.getRankupRules(bridgeId),
        demotionRules: this.getRankupDemotionRules(bridgeId),
        excludedRanks: this.getRankupExcludedRanks(bridgeId),
        excludedPlayers: this.getRankupExcludedPlayers(bridgeId)
      },
      tournament: {
        enabled: this.getTournamentEnabled(bridgeId),
        notificationChannelId: this.getTournamentNotificationChannelId(bridgeId),
        defaultDeadlineHours: this.getTournamentDefaultDeadlineHours(bridgeId),
        defaultBestOf: this.getTournamentDefaultBestOf(bridgeId),
        announceMc: this.getTournamentAnnounceMc(bridgeId),
        checkinWindowMinutes: this.getTournamentCheckinWindowMinutes(bridgeId),
        minParticipants: this.getTournamentMinParticipants(bridgeId),
        maxExtensionHours: this.getTournamentMaxExtensionHours(bridgeId),
        autoCheckin: this.getTournamentAutoCheckin(bridgeId),
        categoryId: this.getTournamentCategoryId(bridgeId),
        bracketFormat: this.getTournamentDefaultBracketFormat(bridgeId),
        validGameTypes: this.getTournamentValidGameTypes(bridgeId)
      }
    }
  }
}
