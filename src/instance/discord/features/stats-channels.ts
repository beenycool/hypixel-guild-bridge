import { isAxiosError } from 'axios'
import type { Channel, Client, Guild } from 'discord.js'
import { DiscordAPIError, GuildChannel, PermissionFlagsBits, TextChannel } from 'discord.js'
import type { Guild as HypixelGuild } from 'hypixel-api-reborn'

import type { StatsChannelsConfig } from '../../../application-config.js'
import type { InstanceType } from '../../../common/application-event.js'
import { Status } from '../../../common/connectable-instance'
import { httpClient } from '../../../common/http.js'
import SubInstance from '../../../common/sub-instance'
import Duration from '../../../utility/duration'
import { setIntervalAsync } from '../../../utility/scheduling'
import type DiscordInstance from '../discord-instance.js'

interface TopicInstance {
  instanceName: string
  uuid(): string | undefined
  currentStatus(): Status
}

interface DiscordStats {
  memberCount: number
  channels: number
  roles: number
}

type StatsVariables = Record<string, string>

interface UrchinDailyResponse {
  guild?: {
    exp?: number
    guildExpByGameType?: Record<string, number>
  }
}

interface StoredStatusChange {
  createdAt: number
  fromStatus: Status
  toStatus: Status
}

const ChannelNameReason = 'Updated stats channels'
const ChannelTopicReason = 'Updated stats topic'
const UrchinDailyEndpoint = 'https://api.urchin.gg/v3/guild/sessions/daily'
const DefaultTopicUpdateInterval = Duration.minutes(5)

export default class StatsChannels extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  private static readonly DefaultUpdateIntervalMinutes = 5

  private readonly updateInterval: Duration
  private readonly lastTopicUpdate = new Map<string, number>()

  constructor(clientInstance: DiscordInstance) {
    super(clientInstance)

    this.updateInterval = StatsChannels.resolveUpdateInterval(this.application.config.statsChannels)

    setIntervalAsync(() => this.updateChannels(), {
      delay: this.updateInterval,
      errorHandler: this.errorHandler.promiseCatch('updating stats channels')
    })

    setIntervalAsync(() => this.updateTopics(), {
      delay: DefaultTopicUpdateInterval,
      errorHandler: this.errorHandler.promiseCatch('updating stats topics')
    })
  }

  override registerEvents(client: Client): void {
    client.on('clientReady', () => {
      void this.updateChannels().catch(this.errorHandler.promiseCatch('updating stats channels'))
      void this.updateTopics().catch(this.errorHandler.promiseCatch('updating stats topics'))
    })
  }

  private static resolveUpdateInterval(config: StatsChannelsConfig | undefined): Duration {
    const intervalMinutes = config?.updateIntervalMinutes ?? StatsChannels.DefaultUpdateIntervalMinutes
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      return Duration.minutes(StatsChannels.DefaultUpdateIntervalMinutes)
    }

    return Duration.minutes(intervalMinutes)
  }

  private async updateChannels(): Promise<void> {
    const config = this.application.config.statsChannels
    if (!config?.enabled) return
    if (config.channels.length === 0) {
      this.logger.warn('Stats channels enabled but no channels are configured.')
      return
    }

    const client = this.clientInstance.getClient()
    if (!client.isReady()) return

    const hypixelGuild = await this.fetchGuild(config)
    if (!hypixelGuild) return

    const discordStatsCache = new Map<string, DiscordStats>()

    for (const channelInfo of config.channels) {
      let channel: Channel | null
      try {
        channel = await client.channels.fetch(channelInfo.id)
      } catch (error: unknown) {
        this.logger.error(`Failed to fetch stats channel ${channelInfo.id}`, error)
        continue
      }

      if (!channel || !(channel instanceof GuildChannel)) {
        this.logger.warn(`Stats channel ${channelInfo.id} is not a guild channel or no longer exists.`)
        continue
      }

      if (!channel.manageable) {
        this.logger.warn(`Missing permissions to update stats channel ${channelInfo.id}.`)
        continue
      }

      const discordStats = await this.resolveDiscordStats(channel.guild, discordStatsCache)
      const variables = this.buildVariables(hypixelGuild, discordStats)
      const updatedName = replaceVariables(channelInfo.name, variables)

      if (channel.name === updatedName) continue

      try {
        await channel.setName(updatedName, ChannelNameReason)
      } catch (error: unknown) {
        if (error instanceof DiscordAPIError) {
          this.logger.error(
            `Failed to update stats channel ${channelInfo.id} with code ${error.code}: ${error.message}`
          )
          continue
        }
        this.logger.error(`Failed to update stats channel ${channelInfo.id}`, error)
      }
    }
  }

  private async updateTopics(): Promise<void> {
    const client = this.clientInstance.getClient()
    if (!client.isReady()) return

    const bridgeConfigurations = this.application.core.bridgeConfigurations
    const discordStatsCache = new Map<string, DiscordStats>()

    for (const bridgeId of bridgeConfigurations.getAllBridgeIds()) {
      try {
        await this.updateBridgeTopic(bridgeId, client, discordStatsCache)
      } catch (error: unknown) {
        this.logger.error(`Failed to update stats topic for bridge ${bridgeId}`, error)
      }
    }
  }

  private async updateBridgeTopic(
    bridgeId: string,
    client: Client,
    discordStatsCache: Map<string, DiscordStats>
  ): Promise<void> {
    const bridgeConfigurations = this.application.core.bridgeConfigurations
    if (!bridgeConfigurations.getStatsTopicEnabled(bridgeId)) return

    const template = bridgeConfigurations.getStatsTopicTemplate(bridgeId).trim()
    if (template.length === 0) return

    const channelIds = bridgeConfigurations.getStatsTopicChannelIds(bridgeId)
    if (channelIds.length === 0) return

    const interval = Duration.minutes(Math.max(1, bridgeConfigurations.getStatsTopicUpdateIntervalMinutes(bridgeId)))
    const lastUpdate = this.lastTopicUpdate.get(bridgeId) ?? 0
    if (lastUpdate + interval.toMilliseconds() > Date.now()) return

    const instance = this.resolveTopicInstance(bridgeId)
    const guildName = bridgeConfigurations.getGuildName(bridgeId)
    const hypixelGuild = await this.withTimeout(this.fetchTopicGuild(instance, guildName), 15_000).catch(
      (error: unknown): HypixelGuild | undefined => {
        if (error instanceof Error && error.name === 'StatsTopicTimeout') {
          this.logger.warn(`Timed out fetching guild info for stats topic of bridge ${bridgeId}.`)
          return undefined
        }
        throw error
      }
    )
    const baseVariables = await this.buildTopicVariables(hypixelGuild, guildName, instance)

    for (const channelId of channelIds) {
      let channel: Channel | null
      try {
        channel = await client.channels.fetch(channelId)
      } catch (error: unknown) {
        this.logger.error(`Failed to fetch stats topic channel ${channelId}`, error)
        continue
      }

      if (!(channel instanceof TextChannel)) {
        this.logger.warn(`Stats topic channel ${channelId} is not a text channel.`)
        continue
      }

      const botMember = await channel.guild.members.fetchMe().catch((error: unknown) => {
        this.logger.error(`Failed to fetch bot member for stats topic channel ${channelId}`, error)
      })
      if (botMember === undefined) continue

      const permissions = channel.permissionsFor(botMember)
      if (
        !permissions.has(
          [PermissionFlagsBits.Administrator, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels],
          false
        )
      ) {
        this.logger.warn(`Missing permissions to update stats topic channel ${channelId}.`)
        continue
      }

      const discordStats = await this.resolveDiscordStats(channel.guild, discordStatsCache)
      const variables: StatsVariables = { ...baseVariables, ...this.buildDiscordVariables(discordStats) }
      const updatedTopic = replaceVariables(template, variables).slice(0, 1024)

      if (channel.topic === updatedTopic) continue

      try {
        await channel.setTopic(updatedTopic, ChannelTopicReason)
        this.lastTopicUpdate.set(bridgeId, Date.now())
        this.logger.info(`Updated stats topic for bridge ${bridgeId} in channel ${channelId}.`)
      } catch (error: unknown) {
        if (error instanceof DiscordAPIError) {
          this.logger.error(
            `Failed to update stats topic channel ${channelId} with code ${error.code}: ${error.message}`
          )
          continue
        }
        this.logger.error(`Failed to update stats topic channel ${channelId}`, error)
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('Operation timed out')
        error.name = 'StatsTopicTimeout'
        reject(error)
      }, milliseconds)

      promise.then(
        (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timeout)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
    })
  }

  private resolveTopicInstance(bridgeId: string): TopicInstance | undefined {
    const instances = this.application.minecraftManager.getAllInstances()
    const configured = this.application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
    if (configured.length > 0) {
      const match = instances.find((instance) => configured.includes(instance.instanceName))
      if (match) return match
    }
    return instances.find((instance) => instance.currentStatus() === Status.Connected) ?? instances[0]
  }

  private async fetchTopicGuild(
    instance: TopicInstance | undefined,
    guildName: string | undefined
  ): Promise<HypixelGuild | undefined> {
    if (instance) {
      const uuid = instance.uuid()
      if (uuid) {
        try {
          return await this.application.hypixelApi.getGuild('player', uuid)
        } catch (error: unknown) {
          this.logger.error(`Failed to fetch Hypixel guild for bot ${instance.instanceName}`, error)
          return undefined
        }
      }
    }

    if (guildName) {
      try {
        return await this.application.hypixelApi.getGuild('name', guildName)
      } catch (error: unknown) {
        this.logger.error(`Failed to fetch Hypixel guild by name "${guildName}"`, error)
        return undefined
      }
    }

    return undefined
  }

  private async buildTopicVariables(
    hypixelGuild: HypixelGuild | undefined,
    guildName: string | undefined,
    instance: TopicInstance | undefined
  ): Promise<StatsVariables> {
    const variables: StatsVariables = {}

    if (hypixelGuild) {
      variables.guildName = hypixelGuild.name
      variables.guildLevel = Math.floor(hypixelGuild.level).toString()
      variables.guildLevelWithProgress = hypixelGuild.level.toFixed(2)
      variables.guildXP = hypixelGuild.experience.toLocaleString()
      variables.guildWeeklyXP = hypixelGuild.totalWeeklyGexp.toLocaleString()
      variables.guildMembers = hypixelGuild.members.length.toLocaleString()
    } else if (guildName) {
      variables.guildName = guildName
    }

    const urchinGuild = guildName ? await this.fetchUrchinDaily(guildName) : undefined
    if (urchinGuild?.guildExpByGameType && Object.keys(urchinGuild.guildExpByGameType).length > 0) {
      const total = Object.values(urchinGuild.guildExpByGameType).reduce((sum, value) => sum + value, 0)
      variables.guildExp24h = fmtCompact(total)
      variables.topGameGexp = formatTopGames(urchinGuild.guildExpByGameType)
    } else if (hypixelGuild) {
      variables.guildExp24h = fmtCompact(this.sumLatestGuildExp(hypixelGuild))
      variables.topGameGexp = ''
    } else {
      variables.guildExp24h = '0'
      variables.topGameGexp = ''
    }

    const chat = await this.resolveChatToday()
    variables.topChatter = chat.topName
    variables.topChatterCount = chat.topCount.toLocaleString()
    variables.messagesToday = chat.total.toLocaleString()

    if (instance) {
      const uptime = await this.resolveUptimePercent(instance.instanceName)
      variables.botStatuses = `${statusEmoji(instance.currentStatus())} ${uptime}%`
      variables.botUptime = `${uptime}%`
    } else {
      variables.botStatuses = ''
      variables.botUptime = ''
    }

    return variables
  }

  private buildDiscordVariables(stats: DiscordStats): StatsVariables {
    return {
      discordMembers: stats.memberCount.toLocaleString(),
      discordChannels: stats.channels.toLocaleString(),
      discordRoles: stats.roles.toLocaleString()
    }
  }

  private async fetchUrchinDaily(guildName: string): Promise<UrchinDailyResponse['guild'] | undefined> {
    const apiKey = this.application.urchinApiKey
    if (!apiKey) return undefined

    try {
      const response = await httpClient.get<UrchinDailyResponse>(UrchinDailyEndpoint, {
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the API
          'X-API-Key': apiKey
        },
        params: { guild: guildName }
      })
      return response.data.guild
    } catch (error: unknown) {
      if (isAxiosError(error) && error.response?.status !== undefined && [401, 403].includes(error.response.status)) {
        return undefined
      }
      this.logger.warn(`Failed to fetch Urchin daily stats for guild "${guildName}"`, error)
      return undefined
    }
  }

  private sumLatestGuildExp(guild: HypixelGuild): number {
    let total = 0
    for (const member of guild.members) {
      const sorted = [...member.expHistory].toSorted((a, b) => b.date.getTime() - a.date.getTime())
      if (sorted.length > 0) total += sorted[0].exp
    }
    return total
  }

  private async resolveChatToday(): Promise<{ topName: string; topCount: number; total: number }> {
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)

    const leaderboard = this.application.core.scoresManager.getMessages(startOfDay.getTime(), Date.now())
    let total = 0
    for (const entry of leaderboard) total += entry.count

    const top = leaderboard[0]
    if (leaderboard.length === 0) return { topName: '—', topCount: 0, total }

    let name = top.uuid
    try {
      const profile = await this.application.mojangApi.profileByUuid(top.uuid)
      name = profile.name
    } catch {}

    return { topName: name, topCount: top.count, total }
  }

  private async resolveUptimePercent(instanceName: string): Promise<number> {
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    const startOfDaySeconds = Math.floor(startOfDay.getTime() / 1000)
    const nowSeconds = Math.floor(Date.now() / 1000)

    const rows = await this.application.core.databaseManager.queryRows<StoredStatusChange>(
      `SELECT "createdAt", "fromStatus", "toStatus" FROM "instanceStatusHistory"
       WHERE "instanceName" = $1 AND "createdAt" >= $2 ORDER BY "createdAt" ASC`,
      [instanceName, startOfDaySeconds - 86_400]
    )

    const lastBeforeDay = rows.findLast((row) => row.createdAt < startOfDaySeconds)
    let status: Status = lastBeforeDay?.toStatus ?? Status.Disconnected
    let connectedSeconds = 0
    let cursor = startOfDaySeconds

    for (const row of rows) {
      if (row.createdAt < startOfDaySeconds || row.createdAt > nowSeconds) continue
      if (status === Status.Connected) connectedSeconds += row.createdAt - cursor
      status = row.toStatus
      cursor = row.createdAt
    }
    if (status === Status.Connected) connectedSeconds += nowSeconds - cursor

    const elapsed = Math.max(1, nowSeconds - startOfDaySeconds)
    return Math.round((connectedSeconds / elapsed) * 100)
  }

  private async fetchGuild(config: StatsChannelsConfig): Promise<HypixelGuild | undefined> {
    const trimmedGuildName = config.guildName?.trim()
    if (trimmedGuildName) {
      try {
        return await this.application.hypixelApi.getGuild('name', trimmedGuildName)
      } catch (error: unknown) {
        this.logger.error(`Failed to fetch Hypixel guild by name "${trimmedGuildName}"`, error)
        return undefined
      }
    }

    const bots = this.application.minecraftManager.getMinecraftBots()
    if (bots.length === 0) {
      this.logger.warn('Stats channels enabled but no Minecraft bots are connected.')
      return undefined
    }

    let selectedBot = bots[0]
    if (config.minecraftInstance) {
      const requested = config.minecraftInstance.toLowerCase()
      const match = bots.find((bot) => bot.instanceName.toLowerCase() === requested)
      if (match) {
        selectedBot = match
      } else {
        this.logger.warn(
          `Stats channels configured for minecraftInstance "${config.minecraftInstance}" but no matching bot was found.`
        )
      }
    }

    try {
      return await this.application.hypixelApi.getGuild('player', selectedBot.uuid)
    } catch (error: unknown) {
      this.logger.error(`Failed to fetch Hypixel guild for bot ${selectedBot.username}`, error)
      return undefined
    }
  }

  private async resolveDiscordStats(guild: Guild, cache: Map<string, DiscordStats>): Promise<DiscordStats> {
    const cached = cache.get(guild.id)
    if (cached) return cached

    let channelsCount = guild.channels.cache.size
    let rolesCount = guild.roles.cache.size

    try {
      const [channels, roles] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()])
      channelsCount = channels.size
      rolesCount = roles.size
    } catch (error: unknown) {
      this.logger.warn(`Failed to fetch channels or roles for guild ${guild.id}, using cached counts.`)
      this.logger.error(error)
    }

    const stats = {
      memberCount: guild.memberCount,
      channels: channelsCount,
      roles: rolesCount
    }

    cache.set(guild.id, stats)
    return stats
  }

  private buildVariables(hypixelGuild: HypixelGuild, discordStats: DiscordStats): StatsVariables {
    return {
      guildName: hypixelGuild.name,
      guildLevel: Math.floor(hypixelGuild.level).toString(),
      guildLevelWithProgress: hypixelGuild.level.toFixed(2),
      guildXP: hypixelGuild.experience.toLocaleString(),
      guildWeeklyXP: hypixelGuild.totalWeeklyGexp.toLocaleString(),
      guildMembers: hypixelGuild.members.length.toLocaleString(),
      discordMembers: discordStats.memberCount.toLocaleString(),
      discordChannels: discordStats.channels.toLocaleString(),
      discordRoles: discordStats.roles.toLocaleString()
    }
  }
}

function replaceVariables(template: string, variables: StatsVariables): string {
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) => variables[name] ?? match)
}

function statusEmoji(status: Status): string {
  switch (status) {
    case Status.Connected: {
      return '🟢'
    }
    case Status.Connecting:
    case Status.Fresh:
    case Status.Disconnected: {
      return '🟡'
    }
    default: {
      return '🔴'
    }
  }
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) {
    const value = n / 1_000_000
    return value < 10 ? value.toFixed(1) + 'M' : Math.round(value).toString() + 'M'
  }
  if (n >= 1000) {
    const value = n / 1000
    return value < 10 ? value.toFixed(1) + 'K' : Math.round(value).toString() + 'K'
  }
  return n.toString()
}

function formatTopGames(byGameType: Record<string, number>): string {
  return Object.entries(byGameType)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([game, exp]) => `${game} ${fmtCompact(exp)}`)
    .join(' · ')
}
