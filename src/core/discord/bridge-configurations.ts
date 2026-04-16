import { debugSessionLog } from '../../utility/debug-session-log.js'
import Duration from '../../utility/duration'
import type { Configuration, ConfigurationsManager } from '../configurations'

/**
 * Configuration for bridge channel mappings stored in the database.
 * This allows dynamic configuration via /settings command.
 * Each bridge has its own complete set of settings.
 */
export class BridgeConfigurations {
  private readonly configuration: Configuration
  private readonly onChange?: (event: { bridgeId: string; key: string; value: unknown }) => void

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
    this.configuration.delete(`${bridgeId}_minecraftInstances`)
    this.configuration.delete(`${bridgeId}_helperRoleIds`)
    this.configuration.delete(`${bridgeId}_officerRoleIds`)
    this.configuration.delete(`${bridgeId}_ownerRoleIds`)
    this.configuration.delete(`${bridgeId}_adminRoleIds`) // legacy cleanup
    this.configuration.delete(`${bridgeId}_alwaysReplyReaction`)
    this.configuration.delete(`${bridgeId}_enforceVerification`)
    this.configuration.delete(`${bridgeId}_textToImage`)
    this.configuration.delete(`${bridgeId}_guildOnline`)
    this.configuration.delete(`${bridgeId}_guildOffline`)
    this.configuration.delete(`${bridgeId}_persistGuildOnlineOffline`)
    this.configuration.delete(`${bridgeId}_temporarilyInteractionsCount`)
    this.configuration.delete(`${bridgeId}_temporarilyInteractionsDuration`)
    this.configuration.delete(`${bridgeId}_skyblockEventsEnabled`)
    this.configuration.delete(`${bridgeId}_skyblockNotifiers`)
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

    // Quality of Life settings
    this.configuration.delete(`${bridgeId}_joinGuildReaction`)
    this.configuration.delete(`${bridgeId}_leaveGuildReaction`)
    this.configuration.delete(`${bridgeId}_kickGuildReaction`)
    this.configuration.delete(`${bridgeId}_guildJoinReactionMessages`)
    this.configuration.delete(`${bridgeId}_guildLeaveReactionMessages`)
    this.configuration.delete(`${bridgeId}_guildKickReactionMessages`)
    this.configuration.delete(`${bridgeId}_darkAuctionReminder`)
    this.configuration.delete(`${bridgeId}_starfallCultReminder`)
    this.configuration.delete(`${bridgeId}_announceMutedPlayer`)
    this.configuration.delete(`${bridgeId}_darkAuctionReminderMessage`)
    this.configuration.delete(`${bridgeId}_starfallReminderMessage`)
    this.configuration.delete(`${bridgeId}_announceMutedPlayerMessage`)
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
    // Legacy guild chaos (plugin removed); keep delete so old keys are purged with the bridge.
    this.configuration.delete(`${bridgeId}_guildChaos`)
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

  // ========== Language Configuration ==========

  /**
   * Get the configured language for a specific bridge (e.g., 'en', 'de', 'ar').
   * Returns undefined when no per-bridge language is set.
   */
  public getLanguage(bridgeId: string): string | undefined {
    const value = this.configuration.getString(`${bridgeId}_language`, '')
    return value === '' ? undefined : value
  }

  /**
   * Set the configured language for a specific bridge. Pass undefined to clear the setting.
   */
  public setLanguage(bridgeId: string, language: string | undefined): void {
    if (language === undefined || language === '') {
      this.configuration.delete(`${bridgeId}_language`)
    } else {
      this.configuration.setString(`${bridgeId}_language`, language)
    }
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
   * Get owner role IDs for a specific bridge
   */
  public getOwnerRoleIds(bridgeId: string): string[] {
    const ownerRoleIds = this.configuration.getStringArray(`${bridgeId}_ownerRoleIds`, [])
    if (ownerRoleIds.length === 0) {
      const legacyAdminRoleIds = this.configuration.getStringArray(`${bridgeId}_adminRoleIds`, [])
      if (legacyAdminRoleIds.length > 0) {
        this.setOwnerRoleIds(bridgeId, legacyAdminRoleIds)
        return legacyAdminRoleIds
      }
    }
    return ownerRoleIds
  }

  /**
   * Set owner role IDs for a specific bridge
   */
  public setOwnerRoleIds(bridgeId: string, roleIds: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_ownerRoleIds`, roleIds)
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

  // ========== Skyblock Event Configurations ==========

  /**
   * Get whether Skyblock events are enabled for a specific bridge
   */
  public getSkyblockEventsEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_skyblockEventsEnabled`, true)
  }

  /**
   * Set whether Skyblock events are enabled for a specific bridge
   */
  public setSkyblockEventsEnabled(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_skyblockEventsEnabled`, enabled)
  }

  /**
   * Get Skyblock event notifiers map for a specific bridge
   */
  public getSkyblockEventNotifiers(bridgeId: string): Record<string, boolean> | undefined {
    const raw = this.configuration.getString(`${bridgeId}_skyblockNotifiers`, '{}')
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>
      // If object has no keys, treat as undefined to allow default behavior
      return Object.keys(parsed).length === 0 ? undefined : parsed
    } catch {
      return undefined
    }
  }

  /**
   * Set a single Skyblock event notifier for a specific bridge
   */
  public setSkyblockEventNotifier(bridgeId: string, eventKey: string, enabled: boolean): void {
    const current = this.getSkyblockEventNotifiers(bridgeId) ?? {}
    current[eventKey] = enabled
    this.configuration.setString(`${bridgeId}_skyblockNotifiers`, JSON.stringify(current))
  }

  /**
   * Remove all Skyblock notifiers for a specific bridge
   */
  public deleteSkyblockNotifiers(bridgeId: string): void {
    this.configuration.delete(`${bridgeId}_skyblockNotifiers`)
  }

  // ========== Moderation Configurations ==========

  /**
   * Get whether heat punishment is enabled for a specific bridge (undefined = use global)
   */
  public getHeatPunishmentEnabled(bridgeId: string): boolean | undefined {
    const value = this.configuration.getString(`${bridgeId}_heatPunishmentEnabled`, '')
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
    const value = this.configuration.getString(`${bridgeId}_profanityEnabled`, '')
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
    const value = this.configuration.getString(`${bridgeId}_commandsEnabled`, '')
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
    const value = this.configuration.getString(`${bridgeId}_commandPrefix`, '')
    return value === '' ? undefined : value
  }

  /**
   * Set chat command prefix for a specific bridge
   */
  public setCommandPrefix(bridgeId: string, prefix: string | undefined): void {
    if (prefix === undefined || prefix === '') {
      this.configuration.delete(`${bridgeId}_commandPrefix`)
    } else {
      this.configuration.setString(`${bridgeId}_commandPrefix`, prefix)
    }
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
    const value = this.configuration.getString(`${bridgeId}_explainCommandOnHelp`, '')
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
    const value = this.configuration.getString(`${bridgeId}_suggestOnTypo`, '')
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

  public getGuildJoinReactionMessages(bridgeId: string, defaultMessages: string[]): string[] {
    return this.configuration.getStringArray(`${bridgeId}_guildJoinReactionMessages`, defaultMessages)
  }

  public setGuildJoinReactionMessages(bridgeId: string, messages: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_guildJoinReactionMessages`, messages)
  }

  public getGuildLeaveReactionMessages(bridgeId: string, defaultMessages: string[]): string[] {
    return this.configuration.getStringArray(`${bridgeId}_guildLeaveReactionMessages`, defaultMessages)
  }

  public setGuildLeaveReactionMessages(bridgeId: string, messages: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_guildLeaveReactionMessages`, messages)
  }

  public getGuildKickReactionMessages(bridgeId: string, defaultMessages: string[]): string[] {
    return this.configuration.getStringArray(`${bridgeId}_guildKickReactionMessages`, defaultMessages)
  }

  public setGuildKickReactionMessages(bridgeId: string, messages: string[]): void {
    this.configuration.setStringArray(`${bridgeId}_guildKickReactionMessages`, messages)
  }

  public getDarkAuctionReminder(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_darkAuctionReminder`, true)
  }

  public setDarkAuctionReminder(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_darkAuctionReminder`, enabled)
  }

  public getStarfallCultReminder(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_starfallCultReminder`, true)
  }

  public setStarfallCultReminder(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_starfallCultReminder`, enabled)
  }

  public getAnnounceMutedPlayer(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_announceMutedPlayer`, true)
  }

  public setAnnounceMutedPlayer(bridgeId: string, enabled: boolean): void {
    this.configuration.setBoolean(`${bridgeId}_announceMutedPlayer`, enabled)
  }

  public getDarkAuctionReminderMessage(bridgeId: string, defaultMessage: string): string {
    return this.configuration.getString(`${bridgeId}_darkAuctionReminderMessage`, defaultMessage)
  }

  public setDarkAuctionReminderMessage(bridgeId: string, message: string): void {
    this.configuration.setString(`${bridgeId}_darkAuctionReminderMessage`, message)
  }

  public getStarfallReminderMessage(bridgeId: string, defaultMessage: string): string {
    return this.configuration.getString(`${bridgeId}_starfallReminderMessage`, defaultMessage)
  }

  public setStarfallReminderMessage(bridgeId: string, message: string): void {
    this.configuration.setString(`${bridgeId}_starfallReminderMessage`, message)
  }

  public getAnnounceMutedPlayerMessage(bridgeId: string, defaultMessage: string): string {
    return this.configuration.getString(`${bridgeId}_announceMutedPlayerMessage`, defaultMessage)
  }

  public setAnnounceMutedPlayerMessage(bridgeId: string, message: string): void {
    this.configuration.setString(`${bridgeId}_announceMutedPlayerMessage`, message)
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
    const value = this.configuration.getString(`${bridgeId}_passthroughPrefix`, '')
    return value === '' ? undefined : value
  }

  /**
   * Set passthrough prefix for a specific bridge
   */
  public setPassthroughPrefix(bridgeId: string, prefix: string | undefined): void {
    if (prefix === undefined || prefix === '') {
      this.configuration.delete(`${bridgeId}_passthroughPrefix`)
    } else {
      this.configuration.setString(`${bridgeId}_passthroughPrefix`, prefix)
    }
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
    this.configuration.setBoolean(`${bridgeId}_rankupEnabled`, enabled)
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
    this.configuration.setBoolean(`${bridgeId}_rankupManualReview`, enabled)
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
    this.configuration.setNumber(`${bridgeId}_rankupNotificationCooldown`, hours)
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
    this.configuration.setStringArray(`${bridgeId}_rankupNotificationChannelIds`, channelIds)
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
    this.configuration.setString(`${bridgeId}_rankupRules`, JSON.stringify(rules))
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
  }[] {
    const raw = this.configuration.getString(`${bridgeId}_rankupDemotionRules`, '[]')
    try {
      return JSON.parse(raw) as {
        fromRank: string
        action: 'demote' | 'kick' | 'notify'
        targetRank?: string
        maxWeeklyGexp: number
        gracePeriod: number
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
    }[]
  ): void {
    const previous = this.getRankupDemotionRules(bridgeId)
    if (previous.length > 0 && rules.length === 0) {
      // #region agent log
      debugSessionLog({
        hypothesisId: 'H8',
        location: 'bridge-configurations.ts:setRankupDemotionRules',
        message: 'Demotion rules cleared (non-empty to empty)',
        data: {
          bridgeId,
          prevLen: previous.length,
          stack: new Error().stack?.split('\n').slice(0, 12).join('\n')
        }
      })
      // #endregion
    }
    this.configuration.setString(`${bridgeId}_rankupDemotionRules`, JSON.stringify(rules))
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
    this.configuration.setStringArray(`${bridgeId}_rankupExcludedRanks`, ranks)
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
    this.configuration.setStringArray(`${bridgeId}_rankupExcludedPlayers`, players)
  }
}
