export const ApplicationConfigVersion = 2

export interface GeneralConfig {
  hypixelApiKey: string
  urchinApiKey?: string
  openrouterApiKey?: string
  openrouterModel?: string
}

export interface StaticDiscordConfig {
  key: string
  adminIds: string[]
}

export interface PrometheusConfig {
  enabled: boolean
  port: number
  prefix: string
  exportPerMember?: boolean
}

export interface DatabaseConfig {
  url?: string
  ssl?: boolean
  maxConnections?: number
}

export interface WebConfig {
  enabled: boolean
  port: number
  token: string
  minecraftInstance?: string
}

export interface StatsChannelConfig {
  id: string
  name: string
}

export interface StatsChannelsConfig {
  enabled: boolean
  updateIntervalMinutes: number
  channels: StatsChannelConfig[]
  guildName?: string
  minecraftInstance?: string
}

export interface VerificationRoleConfig {
  enabled: boolean
  roleId: string
}

export interface LevelRole {
  type: string
  requirement: number | string
  roleId: string
}

export interface VerificationConfig {
  nickname: string
  roles: {
    verified: VerificationRoleConfig
    guildMember: VerificationRoleConfig
    custom: LevelRole[]
  }
  autoRoleUpdater: {
    enabled: boolean
    interval: number
  }
}

export interface GuildRequirementsThresholds {
  bedwarsStars: number
  bedwarsFKDR: number
  skywarsStars: number
  skywarsKDR: number
  duelsWins: number
  duelsWLR: number
  skyblockLevel: number
}

export interface GuildRequirementsConfig {
  enabled: boolean
  requirements: GuildRequirementsThresholds
  autoAccept?: boolean
}

export interface InactivityConfig {
  enabled: boolean
  maxDays: number
  channelIds: string[]
}

export interface SkyblockEventsConfig {
  enabled: boolean
  notifiers?: Record<string, boolean>
  customTimes?: Record<string, string[]>
}

export interface HypixelUpdatesConfig {
  enabled: boolean
  hypixelNews?: boolean
  statusUpdates?: boolean
  skyblockVersion?: boolean
  alphaPlayerCount?: boolean
  pollIntervalMinutes?: number
  alphaCheckIntervalMinutes?: number
}

/**
 * Configuration for a bridge that connects specific Minecraft instances to specific Discord channels.
 * This allows running multiple isolated guild bridges within a single application instance.
 */
export interface BridgeConfig {
  /**
   * Unique identifier for this bridge. Used internally to route messages.
   */
  id: string
  /**
   * Optional language for this bridge (e.g., 'en', 'de', 'ar').
   * If set, this overrides the global application language for messages sent by this bridge.
   */
  language?: string
  /**
   * List of Minecraft instance names that belong to this bridge.
   * Messages from these instances will only be sent to this bridge's Discord channels.
   */
  minecraftInstanceNames: string[]
  /**
   * Discord channel configuration for this bridge.
   */
  discord: {
    /**
     * Public guild chat channel IDs for this bridge.
     */
    publicChannelIds: string[]
    /**
     * Officer guild chat channel IDs for this bridge.
     */
    officerChannelIds: string[]
  }
}

export interface ApplicationConfig {
  version: 2 // typeof ApplicationConfigVersion
  general: GeneralConfig
  discord: StaticDiscordConfig
  prometheus: PrometheusConfig
  database?: DatabaseConfig
  web?: WebConfig
  statsChannels?: StatsChannelsConfig
  verification?: VerificationConfig
  guildRequirements?: GuildRequirementsConfig
  inactivity?: InactivityConfig
  skyblockEvents?: SkyblockEventsConfig
  hypixelUpdates?: HypixelUpdatesConfig
  /**
   * Optional bridge configurations for multi-guild support.
   * If defined, messages will be routed based on bridge membership.
   * If not defined, the legacy global channel configuration is used.
   */
  bridges?: BridgeConfig[]
}
