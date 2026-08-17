import type { Registry } from 'prom-client'
import { Gauge } from 'prom-client'

import type Application from '../../application.js'
import { Status } from '../../common/connectable-instance.js'
import Duration from '../../utility/duration'
import { setIntervalAsync } from '../../utility/scheduling'

interface StoredGuildMemberState {
  instanceName: string
  memberUuid: string
  memberName: string
  rank: string
  joinedAt: number
  lastSeenAt: number
  weeklyGexp: number
  dailyGexp: number
  online: number
}

export default class GuildOnlineMetrics {
  private static readonly SnapshotInterval = Duration.minutes(30)
  private static readonly GuildListCacheTtl = Duration.seconds(30)
  private guildListCache = new Map<
    string,
    {
      members: {
        uuid: string
        username: string
        online: boolean
        rank: string
        joinedAtTimestamp: number
        weeklyExperience: number
        expHistory: { date: Date; exp: number }[]
      }[]
      cachedAt: number
    }
  >()

  private readonly guildTotalMembersCount: Gauge
  private readonly guildOnlineMembersCount: Gauge
  private readonly guildTotalExperience: Gauge
  private readonly guildWeeklyExperience: Gauge
  private readonly memberWeeklyExperience: Gauge
  private readonly memberDailyExperience: Gauge
  private readonly memberJoinedAt: Gauge
  private readonly memberLastSeenAt: Gauge
  private readonly memberOnline: Gauge
  private readonly discordRoleMembers: Gauge
  private readonly guildRankMembers: Gauge
  private readonly guildPendingRankupReviews: Gauge

  constructor(
    register: Registry,
    prefix: string,
    private readonly app: Application,
    private readonly exportPerMember: boolean
  ) {
    this.guildTotalMembersCount = new Gauge({
      name: prefix + 'guild_members',
      help: 'Guild members count',
      labelNames: ['name']
    })
    register.registerMetric(this.guildTotalMembersCount)

    this.guildOnlineMembersCount = new Gauge({
      name: prefix + 'guild_members_online',
      help: 'Guild online members',
      labelNames: ['name']
    })
    register.registerMetric(this.guildOnlineMembersCount)

    this.guildTotalExperience = new Gauge({
      name: prefix + 'guild_gexp_total',
      help: 'Guild total cumulative GEXP',
      labelNames: ['name']
    })
    register.registerMetric(this.guildTotalExperience)

    this.guildWeeklyExperience = new Gauge({
      name: prefix + 'guild_gexp_weekly',
      help: 'Guild weekly GEXP',
      labelNames: ['name']
    })
    register.registerMetric(this.guildWeeklyExperience)

    this.memberWeeklyExperience = new Gauge({
      name: prefix + 'guild_member_gexp_weekly',
      help: 'Per member weekly GEXP snapshot',
      labelNames: ['name', 'member_uuid', 'member_name']
    })
    register.registerMetric(this.memberWeeklyExperience)

    this.memberDailyExperience = new Gauge({
      name: prefix + 'guild_member_gexp_daily',
      help: 'Per member daily GEXP snapshot',
      labelNames: ['name', 'member_uuid', 'member_name']
    })
    register.registerMetric(this.memberDailyExperience)

    this.memberJoinedAt = new Gauge({
      name: prefix + 'guild_member_joined_at',
      help: 'Member join time as unix seconds',
      labelNames: ['name', 'member_uuid', 'member_name']
    })
    register.registerMetric(this.memberJoinedAt)

    this.memberLastSeenAt = new Gauge({
      name: prefix + 'guild_member_last_seen_at',
      help: 'Member last seen time as Unix milliseconds (use time()*1000 in PromQL with time())',
      labelNames: ['name', 'member_uuid', 'member_name']
    })
    register.registerMetric(this.memberLastSeenAt)

    this.memberOnline = new Gauge({
      name: prefix + 'guild_member_online',
      help: 'Member current online status',
      labelNames: ['name', 'member_uuid', 'member_name']
    })
    register.registerMetric(this.memberOnline)

    this.discordRoleMembers = new Gauge({
      name: prefix + 'discord_role_members',
      help: 'Discord role member counts',
      labelNames: ['guild_id', 'role_id', 'role_name']
    })
    register.registerMetric(this.discordRoleMembers)

    this.guildRankMembers = new Gauge({
      name: prefix + 'guild_rank_members',
      help: 'Guild member count per Hypixel in-game rank',
      labelNames: ['name', 'rank_name']
    })
    register.registerMetric(this.guildRankMembers)

    this.guildPendingRankupReviews = new Gauge({
      name: prefix + 'guild_pending_rankup_reviews',
      help: 'Pending manual rankup reviews for the bridge tied to this Minecraft instance',
      labelNames: ['name']
    })
    register.registerMetric(this.guildPendingRankupReviews)

    setIntervalAsync(() => this.snapshotMemberState(), {
      delay: GuildOnlineMetrics.SnapshotInterval,
      errorHandler: this.app.logger.error.bind(this.app.logger, 'snapshotting guild member analytics')
    })
  }

  private async getCachedGuildList(instanceName: string): Promise<{
    members: {
      uuid: string
      username: string
      online: boolean
      rank: string
      joinedAtTimestamp: number
      weeklyExperience: number
      expHistory: { date: Date; exp: number }[]
    }[]
  }> {
    const cached = this.guildListCache.get(instanceName)
    if (cached && Date.now() - cached.cachedAt < GuildOnlineMetrics.GuildListCacheTtl.toMilliseconds()) {
      return cached
    }
    const guildList = await this.app.core.guildManager.list(instanceName)
    const members = guildList.members as {
      uuid: string
      username: string
      online: boolean
      rank: string
      joinedAtTimestamp: number
      weeklyExperience: number
      expHistory: { date: Date; exp: number }[]
    }[]
    this.guildListCache.set(instanceName, { members, cachedAt: Date.now() })
    return { members }
  }

  async collectMetrics(app: Application): Promise<void> {
    this.resetMetrics()

    const instanceNames = app.minecraftManager
      .getAllInstances()
      .filter((inst) => inst.currentStatus() === Status.Connected)
      .map((inst) => inst.instanceName)

    const guildTasks: Promise<unknown>[] = []
    for (const instanceName of instanceNames) {
      guildTasks.push(
        this.getCachedGuildList(instanceName)
          .then((guild) => {
            this.guildTotalMembersCount.set({ name: instanceName }, guild.members.length)
            this.guildOnlineMembersCount.set(
              { name: instanceName },
              guild.members.filter((member) => member.online).length
            )
          })
          .catch(() => undefined)
      )

      const bot = app.minecraftManager.getMinecraftBots().find((entry) => entry.instanceName === instanceName)
      if (bot === undefined) continue

      guildTasks.push(
        (async () => {
          const hypixelGuild = await app.hypixelApi.getGuild('player', bot.uuid)

          this.guildTotalExperience.set({ name: instanceName }, hypixelGuild.experience)
          this.guildWeeklyExperience.set({ name: instanceName }, hypixelGuild.totalWeeklyGexp)

          this.recordGuildManagementMetrics(instanceName, hypixelGuild, app)

          if (!this.exportPerMember) return

          let onlineUuids = new Set<string>()
          try {
            const guildList = await this.getCachedGuildList(instanceName)
            const onlineUsernames = guildList.members.filter((member) => member.online).map((member) => member.username)
            const onlineProfiles = await this.resolveOnlineProfiles(onlineUsernames)
            onlineUuids = new Set([...onlineProfiles.values()].filter((uuid): uuid is string => uuid !== undefined))
          } catch {
            // Online UUID resolution failed, proceed with empty set
          }

          const lastSeenRows = await app.core.databaseManager.queryRows<{ memberUuid: string; lastSeenAt: number }>(
            'SELECT "memberUuid", "lastSeenAt" FROM "guildMemberStates" WHERE "instanceName" = $1',
            [instanceName]
          )
          const lastSeenByUuid = new Map(lastSeenRows.map((row) => [row.memberUuid, row.lastSeenAt]))

          for (const member of hypixelGuild.members) {
            const sortedHistory = member.expHistory.toSorted((a, b) => b.date.getTime() - a.date.getTime())
            const online = onlineUuids.has(member.uuid)
            const profile = await this.app.mojangApi.profileByUuid(member.uuid).catch(() => undefined)
            const memberName = profile?.name ?? member.uuid

            /* eslint-disable @typescript-eslint/naming-convention */
            const labels = {
              name: instanceName,
              member_uuid: member.uuid,
              member_name: memberName
            }
            /* eslint-enable @typescript-eslint/naming-convention */
            this.memberWeeklyExperience.set(labels, member.weeklyExperience)
            this.memberDailyExperience.set(labels, sortedHistory[0]?.exp ?? 0)
            this.memberJoinedAt.set(labels, member.joinedAtTimestamp)
            const lastSeenAt = online ? Date.now() : (lastSeenByUuid.get(member.uuid) ?? member.joinedAtTimestamp)
            this.memberLastSeenAt.set(labels, lastSeenAt)
            this.memberOnline.set(labels, online ? 1 : 0)
          }
        })().catch(() => undefined)
      )
    }

    await Promise.allSettled(guildTasks)

    await this.collectDiscordRoleMetrics(app)
  }

  private async snapshotMemberState(): Promise<void> {
    if (!this.exportPerMember) return

    const connectedInstanceNames = this.app.minecraftManager
      .getAllInstances()
      .filter((inst) => inst.currentStatus() === Status.Connected)
      .map((inst) => inst.instanceName)
    for (const instanceName of connectedInstanceNames) {
      const bot = this.app.minecraftManager.getMinecraftBots().find((entry) => entry.instanceName === instanceName)
      if (bot === undefined) continue

      const [guild, guildList] = await Promise.all([
        this.app.hypixelApi.getGuild('player', bot.uuid),
        this.app.core.guildManager.list(instanceName)
      ])

      const onlineProfiles = await this.resolveOnlineProfiles(
        guildList.members.filter((member) => member.online).map((member) => member.username)
      )
      const onlineUuids = new Set([...onlineProfiles.values()].filter((uuid): uuid is string => uuid !== undefined))

      const existingRows = await this.app.core.databaseManager.queryRows<StoredGuildMemberState>(
        'SELECT * FROM "guildMemberStates" WHERE "instanceName" = $1',
        [instanceName]
      )
      const existingByUuid = new Map(existingRows.map((row) => [row.memberUuid, row]))

      const writes: Promise<unknown>[] = []
      for (const member of guild.members) {
        const sortedHistory = member.expHistory.toSorted((a, b) => b.date.getTime() - a.date.getTime())
        const online = onlineUuids.has(member.uuid)
        const existing = existingByUuid.get(member.uuid)
        const lastSeenAt = online ? Date.now() : (existing?.lastSeenAt ?? member.joinedAtTimestamp)
        const profile = await this.app.mojangApi.profileByUuid(member.uuid).catch(() => undefined)
        const memberName = profile?.name ?? member.uuid

        writes.push(
          this.app.core.databaseManager.execute(
            `INSERT INTO "guildMemberStates" (
              "instanceName", "memberUuid", "memberName", "rank", "joinedAt", "lastSeenAt", "weeklyGexp", "dailyGexp", "online", "updatedAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER))
            ON CONFLICT ("instanceName", "memberUuid") DO UPDATE SET
              "memberName" = EXCLUDED."memberName",
              "rank" = EXCLUDED."rank",
              "joinedAt" = EXCLUDED."joinedAt",
              "lastSeenAt" = EXCLUDED."lastSeenAt",
              "weeklyGexp" = EXCLUDED."weeklyGexp",
              "dailyGexp" = EXCLUDED."dailyGexp",
              "online" = EXCLUDED."online",
              "updatedAt" = EXCLUDED."updatedAt"`,
            [
              instanceName,
              member.uuid,
              memberName,
              member.rank,
              member.joinedAtTimestamp,
              lastSeenAt,
              member.weeklyExperience,
              sortedHistory[0]?.exp ?? 0,
              online ? 1 : 0
            ]
          )
        )
      }

      await Promise.allSettled(writes)
    }
  }

  private async collectDiscordRoleMetrics(app: Application): Promise<void> {
    const client = app.discordInstance.getClient()
    if (!client.isReady()) return

    const tasks: Promise<unknown>[] = []
    for (const guild of client.guilds.cache.values()) {
      tasks.push(
        (async () => {
          await guild.members.fetch().catch(() => undefined)
          const roles = await guild.roles.fetch()
          for (const role of roles.values()) {
            /* eslint-disable @typescript-eslint/naming-convention */
            this.discordRoleMembers.set(
              { guild_id: guild.id, role_id: role.id, role_name: role.name },
              role.members.size
            )
            /* eslint-enable @typescript-eslint/naming-convention */
          }
        })().catch(() => undefined)
      )
    }

    await Promise.allSettled(tasks)
  }

  private async resolveOnlineProfiles(usernames: string[]): Promise<Map<string, string | undefined>> {
    return await this.app.mojangApi.profilesByUsername(new Set(usernames))
  }

  private bridgeIdForMinecraftInstance(instanceName: string): string | undefined {
    return this.app.bridgeResolver.getBridgeIdForInstance(instanceName)
  }

  private recordGuildManagementMetrics(
    instanceName: string,
    hypixelGuild: { members: readonly { rank: string }[] },
    app: Application
  ): void {
    const rankCounts = new Map<string, number>()
    for (const member of hypixelGuild.members) {
      const rankLabel = member.rank.length > 0 ? member.rank : 'UNKNOWN'
      rankCounts.set(rankLabel, (rankCounts.get(rankLabel) ?? 0) + 1)
    }
    for (const [rankName, count] of rankCounts) {
      /* eslint-disable @typescript-eslint/naming-convention */
      this.guildRankMembers.set({ name: instanceName, rank_name: rankName }, count)
      /* eslint-enable @typescript-eslint/naming-convention */
    }

    const bridgeId = this.bridgeIdForMinecraftInstance(instanceName)
    const pendingCount = bridgeId === undefined ? 0 : app.core.pendingReviewManager.getReviews(bridgeId).length
    this.guildPendingRankupReviews.set({ name: instanceName }, pendingCount)
  }

  private resetMetrics(): void {
    this.guildTotalMembersCount.reset()
    this.guildOnlineMembersCount.reset()
    this.guildTotalExperience.reset()
    this.guildWeeklyExperience.reset()
    this.memberWeeklyExperience.reset()
    this.memberDailyExperience.reset()
    this.memberJoinedAt.reset()
    this.memberLastSeenAt.reset()
    this.memberOnline.reset()
    this.discordRoleMembers.reset()
    this.guildRankMembers.reset()
    this.guildPendingRankupReviews.reset()
  }
}
