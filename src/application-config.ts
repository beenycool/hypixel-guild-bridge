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
  token?: string
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
  signingSecret?: string
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

export interface InterviewConfig {
  enabled?: boolean

  question?: string

  timeoutMs?: number
}

export interface InactivityConfig {
  enabled: boolean
  maxDays: number
  channelIds: string[]
}

export interface HypixelUpdatesConfig {
  enabled: boolean
  hypixelNews?: boolean
  statusUpdates?: boolean
  alphaPlayerCount?: boolean
  pollIntervalMinutes?: number
  alphaCheckIntervalMinutes?: number
}

export interface BridgeConfig {
  id: string

  language?: string

  minecraftInstanceNames: string[]

  discord: {
    publicChannelIds: string[]

    officerChannelIds: string[]
  }

  interview?: InterviewConfig
}

export interface TournamentConfig {
  categoryId: string
  roundDeadlineDays: number
  defaultGameMode: 'bridge' | 'bedwars'
  bestOf: number
  staffRoleIds?: string[]
  reminderHours?: number[]
}

export interface LunarClientConfig {
  enabled?: boolean
  minecraftInstance?: string
  cacheSeconds?: number
}

export interface FeatherClientConfig {
  enabled?: boolean
  minecraftInstance?: string
  cacheSeconds?: number
}

export interface EssentialClientConfig {
  enabled?: boolean
  minecraftInstance?: string
  cacheSeconds?: number
}

export interface ApplicationConfig {
  version: typeof ApplicationConfigVersion
  general: GeneralConfig
  discord: StaticDiscordConfig
  prometheus: PrometheusConfig
  database?: DatabaseConfig
  web?: WebConfig
  statsChannels?: StatsChannelsConfig
  verification?: VerificationConfig
  guildRequirements?: GuildRequirementsConfig
  inactivity?: InactivityConfig
  hypixelUpdates?: HypixelUpdatesConfig

  bridges?: BridgeConfig[]
  tournament?: TournamentConfig
  lunarClient?: LunarClientConfig
  featherClient?: FeatherClientConfig
  essentialClient?: EssentialClientConfig
}
