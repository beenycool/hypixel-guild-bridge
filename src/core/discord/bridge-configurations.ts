import type { DynamicBridgeConfig } from '../../common/dynamic-bridge-config.js'
import Duration from '../../utility/duration'
import type { Configuration, ConfigurationsManager } from '../configurations'

export interface BridgeAssignments {
  minecraftInstances: string[]
  publicChannelIds: string[]
  officerChannelIds: string[]
  loggerChannelIds: string[]
  promoteChannelIds: string[]
}

export class BridgeConfigurations implements DynamicBridgeConfig {
  public static readonly MaxBridgeIdLength = 32
  private static readonly ValidBridgeIdPattern = /^[a-z0-9_-]+$/
  private static readonly ReservedBridgeIdFragments = ['_playerusernameoverride_', '_playerrankoverride_']

  private readonly configuration: Configuration
  private readonly onChange?: (event: { bridgeId: string; key: string; value: unknown }) => void

  private getBridgeString(key: string, bridgeId: string, defaultValue = ''): string {
    return this.configuration.getString(`${bridgeId}_${key}`, defaultValue)
  }

  private setBridgeString(key: string, bridgeId: string, value: string | undefined): void {
    const fullKey = `${bridgeId}_${key}`
    this.setConfig(bridgeId, fullKey, value, () => {
      if (value === undefined || value === '') {
        this.configuration.delete(fullKey)
      } else {
        this.configuration.setString(fullKey, value)
      }
    })
  }

  constructor(
    manager: ConfigurationsManager,
    onChange?: (event: { bridgeId: string; key: string; value: unknown }) => void
  ) {
    this.configuration = manager.create('bridges')
    this.onChange = onChange
  }

  public getAllBridgeIds(): string[] {
    const raw = this.configuration.getStringArray('bridgeIds', [])
    const seen = new Set<string>()
    const result: string[] = []
    for (const id of raw) {
      const trimmed = id.trim()
      if (trimmed.length === 0) continue
      const normalized = trimmed.toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      result.push(trimmed)
    }
    return result
  }

  public addBridgeId(bridgeId: string): boolean {
    const normalized = bridgeId.trim().toLowerCase()
    if (normalized.length === 0) return false
    if (normalized.length > BridgeConfigurations.MaxBridgeIdLength) return false
    if (!BridgeConfigurations.ValidBridgeIdPattern.test(normalized)) return false
    if (BridgeConfigurations.ReservedBridgeIdFragments.some((fragment) => normalized.includes(fragment))) return false

    const existing = this.getAllBridgeIds()
    if (existing.some((id) => id.toLowerCase() === normalized)) return false

    this.setConfig(normalized, 'bridgeIds', [...existing, normalized], () => {
      this.configuration.setStringArray('bridgeIds', [...existing, normalized])
    })
    return true
  }

  private setConfig(bridgeId: string, key: string, value: unknown, apply: () => void): void {
    apply()
    if (this.onChange) {
      try {
        this.onChange({ bridgeId, key, value })
      } catch (error: unknown) {
        void error
      }
    }
  }

  public removeBridgeId(bridgeId: string): void {
    const normalized = bridgeId.trim().toLowerCase()
    const existing = this.getAllBridgeIds()
    const matched = existing.find((id) => id.toLowerCase() === normalized)
    const targetId = matched ?? bridgeId

    const filtered = existing.filter((id) => id.toLowerCase() !== normalized)
    this.configuration.setStringArray('bridgeIds', filtered)

    for (const key of this.configuration.keysWithPrefix(`${targetId}_`)) {
      this.configuration.delete(key)
    }

    this.configuration.delete(`${targetId}_publicChannelIds`)
    this.configuration.delete(`${bridgeId}_officerChannelIds`)
    this.configuration.delete(`${bridgeId}_loggerChannelIds`)
    this.configuration.delete(`${bridgeId}_promoteChannelIds`)
    this.configuration.delete(`${bridgeId}_demoteCooldownDays`)
    this.configuration.delete(`${bridgeId}_demoteCooldownUntil`)
    this.configuration.delete(`${bridgeId}_chatSummaryChannelIds`)
    this.configuration.delete(`${bridgeId}_chatSummaryEnabled`)
    this.configuration.delete(`${bridgeId}_minecraftInstances`)
    this.configuration.delete(`${bridgeId}_helperRoleIds`)
    this.configuration.delete(`${bridgeId}_officerRoleIds`)
    this.configuration.delete(`${bridgeId}_ownerRoleIds`)
    this.configuration.delete(`${bridgeId}_joinRequestRoleIds`)

    this.configuration.delete(`${bridgeId}_alwaysReplyReaction`)
    this.configuration.delete(`${bridgeId}_enforceVerification`)
    this.configuration.delete(`${bridgeId}_guildOnline`)
    this.configuration.delete(`${bridgeId}_guildOffline`)
    this.configuration.delete(`${bridgeId}_persistGuildOnlineOffline`)
    this.configuration.delete(`${bridgeId}_temporarilyInteractionsCount`)
    this.configuration.delete(`${bridgeId}_temporarilyInteractionsDuration`)
    this.configuration.delete(`${bridgeId}_persistGuildJoinLeave`)
    this.configuration.delete(`${bridgeId}_joinLeaveInteractionsDuration`)

    this.configuration.delete(`${bridgeId}_profanityEnabled`)

    this.configuration.delete(`${bridgeId}_commandsEnabled`)
    this.configuration.delete(`${bridgeId}_commandPrefix`)
    this.configuration.delete(`${bridgeId}_disabledCommands`)
    this.configuration.delete(`${bridgeId}_explainCommandOnHelp`)
    this.configuration.delete(`${bridgeId}_suggestOnTypo`)
    this.configuration.delete(`${bridgeId}_typoSuggestionThreshold`)
    this.configuration.delete(`${bridgeId}_typoCooldownSeconds`)
    this.configuration.delete(`${bridgeId}_insultMode`)

    this.configuration.delete(`${bridgeId}_joinGuildReaction`)
    this.configuration.delete(`${bridgeId}_leaveGuildReaction`)
    this.configuration.delete(`${bridgeId}_kickGuildReaction`)

    this.configuration.delete(`${bridgeId}_darkAuctionReminder`)
    this.configuration.delete(`${bridgeId}_starfallCultReminder`)
    this.configuration.delete(`${bridgeId}_announceMutedPlayer`)

    this.configuration.delete(`${bridgeId}_botUsernameOverride`)
    this.configuration.delete(`${bridgeId}_botRankOverride`)

    for (const key of this.configuration.keysWithPrefix(
      `${bridgeId}_${BridgeConfigurations.PlayerUsernameOverridePrefix}`
    )) {
      this.configuration.delete(key)
    }

    for (const key of this.configuration.keysWithPrefix(
      `${bridgeId}_${BridgeConfigurations.PlayerRankOverridePrefix}`
    )) {
      this.configuration.delete(key)
    }

    this.configuration.delete(`${bridgeId}_language`)

    this.configuration.delete(`${bridgeId}_rankupEnabled`)
    this.configuration.delete(`${bridgeId}_rankupManualReview`)
    this.configuration.delete(`${bridgeId}_rankupNotificationCooldown`)
    this.configuration.delete(`${bridgeId}_rankupNotificationChannelIds`)
    this.configuration.delete(`${bridgeId}_rankupRules`)
    this.configuration.delete(`${bridgeId}_rankupDemotionRules`)
    this.configuration.delete(`${bridgeId}_rankupExcludedRanks`)
    this.configuration.delete(`${bridgeId}_rankupExcludedPlayers`)
    this.configuration.delete(`${bridgeId}_rankupScheduleDay`)
    this.configuration.delete(`${bridgeId}_rankupScheduleHour`)
    this.configuration.delete(`${bridgeId}_rankupLastRunAt`)

    this.configuration.delete(`${bridgeId}_tournamentEnabled`)
    this.configuration.delete(`${bridgeId}_tournamentNotificationChannelId`)
    this.configuration.delete(`${bridgeId}_tournamentDefaultDeadlineHours`)
    this.configuration.delete(`${bridgeId}_tournamentDefaultBestOf`)
    this.configuration.delete(`${bridgeId}_tournamentAnnounceMc`)
    this.configuration.delete(`${bridgeId}_tournamentDefaultBracketFormat`)
    this.configuration.delete(`${bridgeId}_tournamentValidGameTypes`)

    this.configuration.delete(`${bridgeId}_statsTopicEnabled`)
    this.configuration.delete(`${bridgeId}_statsTopicTemplate`)
    this.configuration.delete(`${bridgeId}_statsTopicChannelIds`)
    this.configuration.delete(`${bridgeId}_statsTopicUpdateIntervalMinutes`)

    this.configuration.delete(`${bridgeId}_interviewEnabled`)
    this.configuration.delete(`${bridgeId}_interviewQuestion`)
    this.configuration.delete(`${bridgeId}_interviewTimeoutMs`)

    this.configuration.delete(`${bridgeId}_inactivityEnabled`)
    this.configuration.delete(`${bridgeId}_inactivityChannelIds`)
    this.configuration.delete(`${bridgeId}_inactivityMaxDays`)

    if (this.onChange) {
      try {
        this.onChange({ bridgeId, key: 'remove_bridge', value: true })
      } catch (error: unknown) {
        void error
      }
    }
  }

  private getAllChannelIds(bridgeId: string): string[] {
    const tournamentChannelId = this.getTournamentNotificationChannelId(bridgeId)

    return [
      ...this.getPublicChannelIds(bridgeId),
      ...this.getOfficerChannelIds(bridgeId),
      ...this.getLoggerChannelIds(bridgeId),
      ...this.getPromoteChannelIds(bridgeId),
      ...this.getChatSummaryChannelIds(bridgeId),
      ...this.getRankupNotificationChannelIds(bridgeId),
      ...this.getStatsTopicChannelIds(bridgeId),
      ...this.getInactivityChannelIds(bridgeId),
      ...(tournamentChannelId === '' ? [] : [tournamentChannelId])
    ]
  }

  public validateChannelOwnership(bridgeId: string, channelIds: string[], label: string): string[] {
    const conflicts: string[] = []
    const normalizedBridgeId = bridgeId.trim().toLowerCase()
    const proposed = new Set<string>()

    for (const rawChannelId of channelIds) {
      const channelId = rawChannelId.trim()
      if (channelId.length === 0) continue
      if (proposed.has(channelId)) {
        conflicts.push(`Duplicate Discord channel "${channelId}" in the ${label} list`)
      }
      proposed.add(channelId)
    }

    for (const otherBridgeId of this.getAllBridgeIds()) {
      if (otherBridgeId.toLowerCase() === normalizedBridgeId) continue

      const otherChannels = new Set(this.getAllChannelIds(otherBridgeId))
      for (const channelId of proposed) {
        if (otherChannels.has(channelId)) {
          conflicts.push(`Discord channel "${channelId}" is already used by bridge "${otherBridgeId}"`)
        }
      }
    }

    return conflicts
  }

  public validateBridgeAssignments(bridgeId: string, assignments: BridgeAssignments): string[] {
    const conflicts: string[] = []
    const normalizedBridgeId = bridgeId.trim().toLowerCase()

    const channelCategoryLists: { label: string; values: string[] }[] = [
      { label: 'public', values: assignments.publicChannelIds },
      { label: 'officer', values: assignments.officerChannelIds },
      { label: 'logger', values: assignments.loggerChannelIds },
      { label: 'promote', values: assignments.promoteChannelIds }
    ]

    const seenInstances = new Set<string>()
    for (const instance of assignments.minecraftInstances) {
      const trimmed = instance.trim()
      if (trimmed.length === 0) continue
      const key = trimmed.toLowerCase()
      if (seenInstances.has(key)) {
        conflicts.push(`Duplicate Minecraft instance "${trimmed}" in the proposed assignment`)
      }
      seenInstances.add(key)
    }

    const seenChannels = new Set<string>()
    for (const { label, values } of channelCategoryLists) {
      for (const channelId of values) {
        const trimmed = channelId.trim()
        if (trimmed.length === 0) continue
        if (seenChannels.has(trimmed)) {
          conflicts.push(`Duplicate Discord channel "${trimmed}" in the ${label} list`)
        }
        seenChannels.add(trimmed)
      }
    }

    for (const otherBridgeId of this.getAllBridgeIds()) {
      if (otherBridgeId.toLowerCase() === normalizedBridgeId) continue

      const otherInstances = new Set(this.getMinecraftInstances(otherBridgeId).map((name) => name.toLowerCase()))
      for (const instance of assignments.minecraftInstances) {
        const trimmed = instance.trim()
        if (trimmed.length === 0) continue
        if (otherInstances.has(trimmed.toLowerCase())) {
          conflicts.push(`Minecraft instance "${trimmed}" is already assigned to bridge "${otherBridgeId}"`)
        }
      }

      const otherChannels = new Set(this.getAllChannelIds(otherBridgeId))
      for (const { values } of channelCategoryLists) {
        for (const channelId of values) {
          const trimmed = channelId.trim()
          if (trimmed.length === 0) continue
          if (otherChannels.has(trimmed)) {
            conflicts.push(`Discord channel "${trimmed}" is already used by bridge "${otherBridgeId}"`)
          }
        }
      }
    }

    const categoryByChannel = new Map<string, string>()
    for (const { label, values } of channelCategoryLists) {
      for (const channelId of values) {
        const trimmed = channelId.trim()
        if (trimmed.length === 0) continue
        const existing = categoryByChannel.get(trimmed)
        if (existing !== undefined && existing !== label) {
          conflicts.push(`Discord channel "${trimmed}" cannot be used for both ${existing} and ${label}`)
        } else {
          categoryByChannel.set(trimmed, label)
        }
      }
    }

    return [...new Set(conflicts)]
  }

  public getPublicChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_publicChannelIds`, [])
  }

  public setPublicChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_publicChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_publicChannelIds`, channelIds)
    })
  }

  public getOfficerChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_officerChannelIds`, [])
  }

  public setOfficerChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_officerChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_officerChannelIds`, channelIds)
    })
  }

  public getLoggerChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_loggerChannelIds`, [])
  }

  public setLoggerChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_loggerChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_loggerChannelIds`, channelIds)
    })
  }

  public getPromoteChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_promoteChannelIds`, [])
  }

  public setPromoteChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_promoteChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_promoteChannelIds`, channelIds)
    })
  }

  public getDemoteCooldownDays(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_demoteCooldownDays`, 0)
  }

  public setDemoteCooldownDays(bridgeId: string, days: number): void {
    this.setConfig(bridgeId, `${bridgeId}_demoteCooldownDays`, days, () => {
      this.configuration.setNumber(`${bridgeId}_demoteCooldownDays`, days)
    })
  }

  public getDemoteCooldownUntil(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_demoteCooldownUntil`, 0)
  }

  public setDemoteCooldownUntil(bridgeId: string, timestamp: number): void {
    this.setConfig(bridgeId, `${bridgeId}_demoteCooldownUntil`, timestamp, () => {
      this.configuration.setNumber(`${bridgeId}_demoteCooldownUntil`, timestamp)
    })
  }

  public getChatSummaryChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_chatSummaryChannelIds`, [])
  }

  public setChatSummaryChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_chatSummaryChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_chatSummaryChannelIds`, channelIds)
    })
  }

  public getChatSummaryEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_chatSummaryEnabled`, false)
  }

  public setChatSummaryEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_chatSummaryEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_chatSummaryEnabled`, enabled)
    })
  }

  public getMinecraftInstances(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_minecraftInstances`, [])
  }

  public setMinecraftInstances(bridgeId: string, instanceNames: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_minecraftInstances`, instanceNames, () => {
      this.configuration.setStringArray(`${bridgeId}_minecraftInstances`, instanceNames)
    })
  }

  public getBotUsernameOverride(bridgeId: string): string | undefined {
    const value = this.getBridgeString('botUsernameOverride', bridgeId)
    return value === '' ? undefined : value
  }

  public setBotUsernameOverride(bridgeId: string, name: string | undefined): void {
    this.setBridgeString('botUsernameOverride', bridgeId, name)
  }

  private static readonly PlayerUsernameOverridePrefix = 'playerUsernameOverride_'

  public getPlayerUsernameOverride(bridgeId: string, playerName: string): string | undefined {
    const value = this.getBridgeString(
      `${BridgeConfigurations.PlayerUsernameOverridePrefix}${playerName.toLowerCase()}`,
      bridgeId
    )
    return value === '' ? undefined : value
  }

  public setPlayerUsernameOverride(bridgeId: string, playerName: string, name: string | undefined): void {
    this.setBridgeString(
      `${BridgeConfigurations.PlayerUsernameOverridePrefix}${playerName.toLowerCase()}`,
      bridgeId,
      name
    )
  }

  public getPlayerUsernameOverrides(bridgeId: string): Record<string, string> {
    const overrides: Record<string, string> = {}
    const prefix = `${bridgeId}_${BridgeConfigurations.PlayerUsernameOverridePrefix}`
    for (const fullKey of this.configuration.keysWithPrefix(prefix)) {
      const playerName = fullKey.slice(prefix.length)
      const value = this.configuration.getString(fullKey, '')
      if (value !== '') overrides[playerName] = value
    }
    return overrides
  }

  public getBotRankOverride(bridgeId: string): string | undefined {
    const v = this.getBridgeString('botRankOverride', bridgeId)
    return v == '' ? undefined : v
  }

  public setBotRankOverride(bridgeId: string, rank: string | undefined): void {
    this.setBridgeString('botRankOverride', bridgeId, rank)
  }

  private static readonly PlayerRankOverridePrefix = 'playerRankOverride_'

  public getPlayerRankOverride(bridgeId: string, playerName: string): string | undefined {
    const v = this.getBridgeString(
      `${BridgeConfigurations.PlayerRankOverridePrefix}${playerName.toLowerCase()}`,
      bridgeId
    )
    return v == '' ? undefined : v
  }

  public setPlayerRankOverride(bridgeId: string, playerName: string, rank: string | undefined): void {
    this.setBridgeString(`${BridgeConfigurations.PlayerRankOverridePrefix}${playerName.toLowerCase()}`, bridgeId, rank)
  }

  public getPlayerRankOverrides(bridgeId: string): Record<string, string> {
    const overrides: Record<string, string> = {}
    const prefix = `${bridgeId}_${BridgeConfigurations.PlayerRankOverridePrefix}`
    for (const fullKey of this.configuration.keysWithPrefix(prefix)) {
      const playerName = fullKey.slice(prefix.length)
      const value = this.configuration.getString(fullKey, '')
      if (value != '') overrides[playerName] = value
    }
    return overrides
  }

  public getLanguage(bridgeId: string): string | undefined {
    const value = this.getBridgeString('language', bridgeId)
    return value === '' ? undefined : value
  }

  public setLanguage(bridgeId: string, language: string | undefined): void {
    this.setBridgeString('language', bridgeId, language)
  }

  public getGuildName(bridgeId: string): string | undefined {
    const value = this.getBridgeString('guildName', bridgeId)
    return value === '' ? undefined : value
  }

  public setGuildName(bridgeId: string, name: string | undefined): void {
    this.setBridgeString('guildName', bridgeId, name)
  }

  public getHelperRoleIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_helperRoleIds`, [])
  }

  public setHelperRoleIds(bridgeId: string, roleIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_helperRoleIds`, roleIds, () => {
      this.configuration.setStringArray(`${bridgeId}_helperRoleIds`, roleIds)
    })
  }

  public getOfficerRoleIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_officerRoleIds`, [])
  }

  public setOfficerRoleIds(bridgeId: string, roleIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_officerRoleIds`, roleIds, () => {
      this.configuration.setStringArray(`${bridgeId}_officerRoleIds`, roleIds)
    })
  }

  public getOwnerRoleIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_ownerRoleIds`, [])
  }

  public setOwnerRoleIds(bridgeId: string, roleIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_ownerRoleIds`, roleIds, () => {
      this.configuration.setStringArray(`${bridgeId}_ownerRoleIds`, roleIds)
    })
  }

  public getJoinRequestRoleIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_joinRequestRoleIds`, [])
  }

  public setJoinRequestRoleIds(bridgeId: string, roleIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_joinRequestRoleIds`, roleIds, () => {
      this.configuration.setStringArray(`${bridgeId}_joinRequestRoleIds`, roleIds)
    })
  }

  public getAlwaysReplyReaction(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_alwaysReplyReaction`, false)
  }

  public setAlwaysReplyReaction(bridgeId: string, value: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_alwaysReplyReaction`, value, () => {
      this.configuration.setBoolean(`${bridgeId}_alwaysReplyReaction`, value)
    })
  }

  public getEnforceVerification(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_enforceVerification`, false)
  }

  public setEnforceVerification(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_enforceVerification`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_enforceVerification`, enabled)
    })
  }

  public getGuildOnline(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_guildOnline`, true)
  }

  public setGuildOnline(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_guildOnline`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_guildOnline`, enabled)
    })
  }

  public getGuildOffline(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_guildOffline`, true)
  }

  public setGuildOffline(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_guildOffline`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_guildOffline`, enabled)
    })
  }

  public getPersistGuildOnlineOffline(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_persistGuildOnlineOffline`, false)
  }

  public setPersistGuildOnlineOffline(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_persistGuildOnlineOffline`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_persistGuildOnlineOffline`, enabled)
    })
  }

  public getMaxTemporarilyInteractions(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_temporarilyInteractionsCount`, 5)
  }

  public setMaxTemporarilyInteractions(bridgeId: string, value: number): void {
    this.setConfig(bridgeId, `${bridgeId}_temporarilyInteractionsCount`, value, () => {
      this.configuration.setNumber(`${bridgeId}_temporarilyInteractionsCount`, value)
    })
  }

  public getDurationTemporarilyInteractions(bridgeId: string): Duration {
    const value = this.configuration.getNumber(
      `${bridgeId}_temporarilyInteractionsDuration`,
      Duration.minutes(15).toSeconds()
    )
    return Duration.seconds(value)
  }

  public setDurationTemporarilyInteractions(bridgeId: string, value: Duration): void {
    const seconds = value.toSeconds()
    this.setConfig(bridgeId, `${bridgeId}_temporarilyInteractionsDuration`, seconds, () => {
      this.configuration.setNumber(`${bridgeId}_temporarilyInteractionsDuration`, seconds)
    })
  }

  public getPersistGuildJoinLeave(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_persistGuildJoinLeave`, false)
  }

  public setPersistGuildJoinLeave(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_persistGuildJoinLeave`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_persistGuildJoinLeave`, enabled)
    })
  }

  public getDurationJoinLeaveInteractions(bridgeId: string): Duration {
    const value = this.configuration.getNumber(
      `${bridgeId}_joinLeaveInteractionsDuration`,
      Duration.days(2).toSeconds()
    )
    return Duration.seconds(value)
  }

  public setDurationJoinLeaveInteractions(bridgeId: string, value: Duration): void {
    const seconds = value.toSeconds()
    this.setConfig(bridgeId, `${bridgeId}_joinLeaveInteractionsDuration`, seconds, () => {
      this.configuration.setNumber(`${bridgeId}_joinLeaveInteractionsDuration`, seconds)
    })
  }

  public getProfanityEnabled(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('profanityEnabled', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  public setProfanityEnabled(bridgeId: string, enabled: boolean | undefined): void {
    this.setConfig(bridgeId, `${bridgeId}_profanityEnabled`, enabled, () => {
      if (enabled === undefined) {
        this.configuration.delete(`${bridgeId}_profanityEnabled`)
      } else {
        this.configuration.setString(`${bridgeId}_profanityEnabled`, enabled ? 'true' : 'false')
      }
    })
  }

  public getCommandsEnabled(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('commandsEnabled', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  public setCommandsEnabled(bridgeId: string, enabled: boolean | undefined): void {
    this.setConfig(bridgeId, `${bridgeId}_commandsEnabled`, enabled, () => {
      if (enabled === undefined) {
        this.configuration.delete(`${bridgeId}_commandsEnabled`)
      } else {
        this.configuration.setString(`${bridgeId}_commandsEnabled`, enabled ? 'true' : 'false')
      }
    })
  }

  public getCommandPrefix(bridgeId: string): string | undefined {
    const value = this.getBridgeString('commandPrefix', bridgeId)
    return value === '' ? undefined : value
  }

  public setCommandPrefix(bridgeId: string, prefix: string | undefined): void {
    this.setBridgeString('commandPrefix', bridgeId, prefix)
  }

  public getDisabledCommands(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_disabledCommands`, [])
  }

  public setDisabledCommands(bridgeId: string, commands: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_disabledCommands`, commands, () => {
      this.configuration.setStringArray(`${bridgeId}_disabledCommands`, commands)
    })
  }

  public getExplainCommandOnHelp(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('explainCommandOnHelp', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  public setExplainCommandOnHelp(bridgeId: string, enabled: boolean | undefined): void {
    this.setConfig(bridgeId, `${bridgeId}_explainCommandOnHelp`, enabled, () => {
      if (enabled === undefined) {
        this.configuration.delete(`${bridgeId}_explainCommandOnHelp`)
      } else {
        this.configuration.setString(`${bridgeId}_explainCommandOnHelp`, enabled ? 'true' : 'false')
      }
    })
  }

  public getSuggestOnTypo(bridgeId: string): boolean | undefined {
    const value = this.getBridgeString('suggestOnTypo', bridgeId)
    if (value === '') return undefined
    return value === 'true'
  }

  public setSuggestOnTypo(bridgeId: string, enabled: boolean | undefined): void {
    this.setConfig(bridgeId, `${bridgeId}_suggestOnTypo`, enabled, () => {
      if (enabled === undefined) {
        this.configuration.delete(`${bridgeId}_suggestOnTypo`)
      } else {
        this.configuration.setString(`${bridgeId}_suggestOnTypo`, enabled ? 'true' : 'false')
      }
    })
  }

  public getTypoSuggestionThreshold(bridgeId: string): number | undefined {
    const value = this.configuration.getNumber(`${bridgeId}_typoSuggestionThreshold`, -1)
    return value === -1 ? undefined : value
  }

  public setTypoSuggestionThreshold(bridgeId: string, threshold: number | undefined): void {
    this.setConfig(bridgeId, `${bridgeId}_typoSuggestionThreshold`, threshold, () => {
      if (threshold === undefined) {
        this.configuration.delete(`${bridgeId}_typoSuggestionThreshold`)
      } else {
        this.configuration.setNumber(`${bridgeId}_typoSuggestionThreshold`, threshold)
      }
    })
  }

  public getTypoCooldownSeconds(bridgeId: string): number | undefined {
    const value = this.configuration.getNumber(`${bridgeId}_typoCooldownSeconds`, -1)
    return value === -1 ? undefined : value
  }

  public setTypoCooldownSeconds(bridgeId: string, seconds: number | undefined): void {
    this.setConfig(bridgeId, `${bridgeId}_typoCooldownSeconds`, seconds, () => {
      if (seconds === undefined) {
        this.configuration.delete(`${bridgeId}_typoCooldownSeconds`)
      } else {
        this.configuration.setNumber(`${bridgeId}_typoCooldownSeconds`, seconds)
      }
    })
  }

  public getInsultMode(bridgeId: string): string | undefined {
    const value = this.getBridgeString('insultMode', bridgeId)
    return value === '' ? undefined : value
  }

  public setInsultMode(bridgeId: string, mode: string | undefined): void {
    this.setBridgeString('insultMode', bridgeId, mode)
  }

  public getJoinGuildReaction(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_joinGuildReaction`, true)
  }

  public setJoinGuildReaction(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_joinGuildReaction`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_joinGuildReaction`, enabled)
    })
  }

  public getLeaveGuildReaction(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_leaveGuildReaction`, true)
  }

  public setLeaveGuildReaction(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_leaveGuildReaction`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_leaveGuildReaction`, enabled)
    })
  }

  public getKickGuildReaction(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_kickGuildReaction`, true)
  }

  public setKickGuildReaction(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_kickGuildReaction`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_kickGuildReaction`, enabled)
    })
  }

  public getJoinReactionEmojiType(bridgeId: string): string {
    return this.configuration.getString(`${bridgeId}_joinReactionEmojiType`, 'none')
  }

  public setJoinReactionEmojiType(bridgeId: string, value: string): void {
    this.setConfig(bridgeId, `${bridgeId}_joinReactionEmojiType`, value, () => {
      this.configuration.setString(`${bridgeId}_joinReactionEmojiType`, value)
    })
  }

  public getLeaveReactionEmojiType(bridgeId: string): string {
    return this.configuration.getString(`${bridgeId}_leaveReactionEmojiType`, 'none')
  }

  public setLeaveReactionEmojiType(bridgeId: string, value: string): void {
    this.setConfig(bridgeId, `${bridgeId}_leaveReactionEmojiType`, value, () => {
      this.configuration.setString(`${bridgeId}_leaveReactionEmojiType`, value)
    })
  }

  public getAnnounceMutedPlayer(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_announceMutedPlayer`, true)
  }

  public setAnnounceMutedPlayer(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_announceMutedPlayer`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_announceMutedPlayer`, enabled)
    })
  }

  public getRankupEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_rankupEnabled`, false)
  }

  public setRankupEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_rankupEnabled`, enabled)
    })
  }

  public getRankupManualReview(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_rankupManualReview`, false)
  }

  public setRankupManualReview(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupManualReview`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_rankupManualReview`, enabled)
    })
  }

  public getRankupNotificationCooldown(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_rankupNotificationCooldown`, 24)
  }

  public setRankupNotificationCooldown(bridgeId: string, hours: number): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupNotificationCooldown`, hours, () => {
      this.configuration.setNumber(`${bridgeId}_rankupNotificationCooldown`, hours)
    })
  }

  public getRankupNotificationChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_rankupNotificationChannelIds`, [])
  }

  public setRankupNotificationChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupNotificationChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_rankupNotificationChannelIds`, channelIds)
    })
  }

  public getRankupPingUserIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_rankupPingUserIds`, [])
  }

  public setRankupPingUserIds(bridgeId: string, userIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupPingUserIds`, userIds, () => {
      this.configuration.setStringArray(`${bridgeId}_rankupPingUserIds`, userIds)
    })
  }

  public getRankupScheduleDay(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_rankupScheduleDay`, -1)
  }

  public setRankupScheduleDay(bridgeId: string, day: number): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupScheduleDay`, day, () => {
      this.configuration.setNumber(`${bridgeId}_rankupScheduleDay`, day)
    })
  }

  public getRankupScheduleHour(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_rankupScheduleHour`, -1)
  }

  public setRankupScheduleHour(bridgeId: string, hour: number): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupScheduleHour`, hour, () => {
      this.configuration.setNumber(`${bridgeId}_rankupScheduleHour`, hour)
    })
  }

  public getRankupLastRunAt(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_rankupLastRunAt`, -1)
  }

  public setRankupLastRunAt(bridgeId: string, timestamp: number): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupLastRunAt`, timestamp, () => {
      this.configuration.setNumber(`${bridgeId}_rankupLastRunAt`, timestamp)
    })
  }

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

  public getRankupExcludedRanks(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_rankupExcludedRanks`, [])
  }

  public setRankupExcludedRanks(bridgeId: string, ranks: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupExcludedRanks`, ranks, () => {
      this.configuration.setStringArray(`${bridgeId}_rankupExcludedRanks`, ranks)
    })
  }

  public getRankupExcludedPlayers(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_rankupExcludedPlayers`, [])
  }

  public setRankupExcludedPlayers(bridgeId: string, players: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_rankupExcludedPlayers`, players, () => {
      this.configuration.setStringArray(`${bridgeId}_rankupExcludedPlayers`, players)
    })
  }

  public getTournamentEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_tournamentEnabled`, false)
  }

  public setTournamentEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_tournamentEnabled`, enabled)
    })
  }

  public getTournamentNotificationChannelId(bridgeId: string): string {
    return this.configuration.getString(`${bridgeId}_tournamentNotificationChannelId`, '')
  }

  public setTournamentNotificationChannelId(bridgeId: string, channelId: string): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentNotificationChannelId`, channelId, () => {
      this.configuration.setString(`${bridgeId}_tournamentNotificationChannelId`, channelId)
    })
  }

  public getTournamentDefaultDeadlineHours(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_tournamentDefaultDeadlineHours`, 48)
  }

  public setTournamentDefaultDeadlineHours(bridgeId: string, hours: number): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentDefaultDeadlineHours`, hours, () => {
      this.configuration.setNumber(`${bridgeId}_tournamentDefaultDeadlineHours`, hours)
    })
  }

  public getTournamentDefaultBestOf(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_tournamentDefaultBestOf`, 1)
  }

  public setTournamentDefaultBestOf(bridgeId: string, bestOf: number): void {
    this.setConfig(bridgeId, `${bridgeId}_tournamentDefaultBestOf`, bestOf, () => {
      this.configuration.setNumber(`${bridgeId}_tournamentDefaultBestOf`, bestOf)
    })
  }

  public getTournamentAnnounceMc(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_tournamentAnnounceMc`, true)
  }

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
    this.setConfig(bridgeId, `${bridgeId}_translationOverrides`, overrides, () => {
      this.configuration.setString(`${bridgeId}_translationOverrides`, JSON.stringify(overrides))
    })
  }

  public getStatsTopicEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_statsTopicEnabled`, false)
  }

  public setStatsTopicEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_statsTopicEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_statsTopicEnabled`, enabled)
    })
  }

  public getStatsTopicTemplate(bridgeId: string): string {
    return this.configuration.getString(`${bridgeId}_statsTopicTemplate`, '')
  }

  public setStatsTopicTemplate(bridgeId: string, template: string | undefined): void {
    this.setConfig(bridgeId, `${bridgeId}_statsTopicTemplate`, template, () => {
      if (template === undefined || template === '') {
        this.configuration.delete(`${bridgeId}_statsTopicTemplate`)
      } else {
        this.configuration.setString(`${bridgeId}_statsTopicTemplate`, template)
      }
    })
  }

  public getStatsTopicChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_statsTopicChannelIds`, [])
  }

  public setStatsTopicChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_statsTopicChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_statsTopicChannelIds`, channelIds)
    })
  }

  public getStatsTopicUpdateIntervalMinutes(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_statsTopicUpdateIntervalMinutes`, 5)
  }

  public setStatsTopicUpdateIntervalMinutes(bridgeId: string, minutes: number): void {
    this.setConfig(bridgeId, `${bridgeId}_statsTopicUpdateIntervalMinutes`, minutes, () => {
      this.configuration.setNumber(`${bridgeId}_statsTopicUpdateIntervalMinutes`, minutes)
    })
  }

  public getInterviewEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_interviewEnabled`, false)
  }

  public setInterviewEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_interviewEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_interviewEnabled`, enabled)
    })
  }

  public getInterviewQuestion(bridgeId: string): string {
    return this.getBridgeString('interviewQuestion', bridgeId)
  }

  public setInterviewQuestion(bridgeId: string, question: string | undefined): void {
    this.setBridgeString('interviewQuestion', bridgeId, question)
  }

  public getInterviewTimeoutMs(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_interviewTimeoutMs`, 600_000)
  }

  public setInterviewTimeoutMs(bridgeId: string, timeoutMs: number): void {
    const normalized = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 600_000
    this.setConfig(bridgeId, `${bridgeId}_interviewTimeoutMs`, normalized, () => {
      this.configuration.setNumber(`${bridgeId}_interviewTimeoutMs`, normalized)
    })
  }

  public getInactivityEnabled(bridgeId: string): boolean {
    return this.configuration.getBoolean(`${bridgeId}_inactivityEnabled`, false)
  }

  public setInactivityEnabled(bridgeId: string, enabled: boolean): void {
    this.setConfig(bridgeId, `${bridgeId}_inactivityEnabled`, enabled, () => {
      this.configuration.setBoolean(`${bridgeId}_inactivityEnabled`, enabled)
    })
  }

  public getInactivityChannelIds(bridgeId: string): string[] {
    return this.configuration.getStringArray(`${bridgeId}_inactivityChannelIds`, [])
  }

  public setInactivityChannelIds(bridgeId: string, channelIds: string[]): void {
    this.setConfig(bridgeId, `${bridgeId}_inactivityChannelIds`, channelIds, () => {
      this.configuration.setStringArray(`${bridgeId}_inactivityChannelIds`, channelIds)
    })
  }

  public getInactivityMaxDays(bridgeId: string): number {
    return this.configuration.getNumber(`${bridgeId}_inactivityMaxDays`, 30)
  }

  public setInactivityMaxDays(bridgeId: string, days: number): void {
    const normalized = Math.max(0, Math.floor(days))
    this.setConfig(bridgeId, `${bridgeId}_inactivityMaxDays`, normalized, () => {
      this.configuration.setNumber(`${bridgeId}_inactivityMaxDays`, normalized)
    })
  }

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
        language: this.getLanguage(bridgeId) ?? '',
        botUsernameOverride: this.getBotUsernameOverride(bridgeId) ?? '',
        botRankOverride: this.getBotRankOverride(bridgeId) ?? '',
        playerUsernameOverrides: this.getPlayerUsernameOverrides(bridgeId),
        playerRankOverrides: this.getPlayerRankOverrides(bridgeId)
      },
      minecraftEvents: {
        memberOnline: this.getGuildOnline(bridgeId),
        memberOffline: this.getGuildOffline(bridgeId),
        persistOnlineOffline: this.getPersistGuildOnlineOffline(bridgeId),
        deleteAfterSeconds: this.getDurationTemporarilyInteractions(bridgeId).toSeconds(),
        maxEvents: this.getMaxTemporarilyInteractions(bridgeId),
        persistJoinLeave: this.getPersistGuildJoinLeave(bridgeId),
        deleteJoinLeaveAfterSeconds: this.getDurationJoinLeaveInteractions(bridgeId).toSeconds()
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
        profanityFilterEnabled: this.getProfanityEnabled(bridgeId)
      },
      chatCommands: {
        commandsEnabled: this.getCommandsEnabled(bridgeId),
        chatCommandPrefix: this.getCommandPrefix(bridgeId) ?? '',
        insultMode: this.getInsultMode(bridgeId) ?? ''
      },
      rankup: {
        enabled: this.getRankupEnabled(bridgeId),
        manualReview: this.getRankupManualReview(bridgeId),
        notificationCooldown: this.getRankupNotificationCooldown(bridgeId),
        notificationChannelIds: this.getRankupNotificationChannelIds(bridgeId),
        pingUserIds: this.getRankupPingUserIds(bridgeId),
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
      },
      statsChannels: {
        enabled: this.getStatsTopicEnabled(bridgeId),
        template: this.getStatsTopicTemplate(bridgeId),
        channelIds: this.getStatsTopicChannelIds(bridgeId),
        updateIntervalMinutes: this.getStatsTopicUpdateIntervalMinutes(bridgeId)
      },
      interview: {
        enabled: this.getInterviewEnabled(bridgeId),
        question: this.getInterviewQuestion(bridgeId),
        timeoutMs: this.getInterviewTimeoutMs(bridgeId)
      },
      inactivity: {
        enabled: this.getInactivityEnabled(bridgeId),
        channelIds: this.getInactivityChannelIds(bridgeId),
        maxDays: this.getInactivityMaxDays(bridgeId)
      }
    }
  }
}
