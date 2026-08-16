export const ApplicationConfigVersion = 2

export interface GeneralConfig {
  hypixelApiKey: string
  urchinApiKey?: string
  seraphApiKey?: string
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
  signingSecret?: string
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

export interface LunarClientConfig {
  enabled?: boolean
  minecraftInstance?: string
  cacheSeconds?: number
}

export interface ApplicationConfig {
  version: 2
  general: GeneralConfig
  discord: StaticDiscordConfig
  prometheus: PrometheusConfig
  database?: DatabaseConfig
  web?: WebConfig
  verification?: VerificationConfig
  guildRequirements?: GuildRequirementsConfig
  lunarClient?: LunarClientConfig
}
