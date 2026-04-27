import type { Registry } from 'prom-client'
import { Gauge } from 'prom-client'

import type Application from '../../application.js'
import { InstanceType } from '../../common/application-event.js'
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
  private static readonly EventRetention = Duration.days(90)
  private static readonly SnapshotRetention = Duration.days(365)

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
      help: 'Member last seen time as unix seconds',
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

    this.app.core.databaseManager.registerCleaner(() => this.clean())

    setIntervalAsync(() => this.snapshotMemberState(), {
      delay: GuildOnlineMetrics.SnapshotInterval,
      errorHandler: this.app.logger.error.bind(this.app.logger, 'snapshotting guild member analytics')
    })
  }

  async collectMetrics(app: Application): Promise<void> {
    this.resetMetrics()

    const instanceNames = app.getInstancesNames(InstanceType.Minecraft)
    this.app.logger.debug(`collectMetrics: instances=${instanceNames.join(',')}`)

    const guildTasks: Promise<unknown>[] = []
    for (const instanceName of instanceNames) {
      // Guild list (members + online) – independent promise with catch
      guildTasks.push(
        app.core.guildManager
          .list(instanceName)
          .then((guild) => {
            this.app.logger.debug(
              `collectMetrics: ${instanceName} list=${guild.members.length} online=${guild.members.filter((m) => m.online).length}`
            )
            this.guildTotalMembersCount.set({ name: instanceName }, guild.members.length)
            this.guildOnlineMembersCount.set(
              { name: instanceName },
              guild.members.filter((member) => member.online).length
            )
          })
          .catch((err) => {
            this.app.logger.debug(`collectMetrics: ${instanceName} list failed: ${String(err)}`)
          })
      )

      const bot = app.minecraftManager.getMinecraftBots().find((entry) => entry.instanceName === instanceName)
      if (bot === undefined) continue

      // Hypixel API data (GEXP + per-member) – independent promise with catch
      guildTasks.push(
        (async () => {
          this.app.logger.debug(`collectMetrics: ${instanceName} fetching Hypixel API for ${bot.uuid}`)
          const hypixelGuild = await app.hypixelApi.getGuild('player', bot.uuid)
          this.app.logger.debug(
            `collectMetrics: ${instanceName} Hypixel API ok, members=${hypixelGuild.members.length} gexp=${hypixelGuild.experience}`
          )

          this.guildTotalExperience.set({ name: instanceName }, hypixelGuild.experience)
          this.guildWeeklyExperience.set({ name: instanceName }, hypixelGuild.totalWeeklyGexp)

          if (!this.exportPerMember) return

          // Try to get online status from guild list, but don't fail if disconnected
          let onlineUuids = new Set<string>()
          try {
            const guildList = await app.core.guildManager.list(instanceName)
            const onlineUsernames = guildList.members.filter((member) => member.online).map((member) => member.username)
            const onlineProfiles = await this.resolveOnlineProfiles(onlineUsernames)
            onlineUuids = new Set([...onlineProfiles.values()].filter((uuid): uuid is string => uuid !== undefined))
          } catch {
            // Bot disconnected – all members appear offline
          }

          for (const member of hypixelGuild.members) {
            const sortedHistory = member.expHistory.toSorted((a, b) => b.date.getTime() - a.date.getTime())
            const online = onlineUuids.has(member.uuid)
            const memberName =
              (await this.app.mojangApi.profileByUuid(member.uuid).catch(() => undefined))?.name ?? member.uuid

            const labels = {
              name: instanceName,
              member_uuid: member.uuid,
              member_name: memberName
            }
            this.memberWeeklyExperience.set(labels, member.weeklyExperience)
            this.memberDailyExperience.set(labels, sortedHistory[0]?.exp ?? 0)
            this.memberJoinedAt.set(labels, member.joinedAtTimestamp)
            this.memberLastSeenAt.set(labels, online ? Date.now() : member.joinedAtTimestamp)
            this.memberOnline.set(labels, online ? 1 : 0)
          }
        })().catch((err) => {
          this.app.logger.debug(`collectMetrics: ${instanceName} Hypixel API failed: ${String(err)}`)
        })
      )
    }

    await Promise.allSettled(guildTasks)

    this.app.logger.debug('collectMetrics: collecting Discord roles')
    await this.collectDiscordRoleMetrics(app)
    this.app.logger.debug('collectMetrics: done')
  }

  private async snapshotMemberState(): Promise<void> {
    if (!this.exportPerMember) return

    const currentDay = Math.floor(Date.now() / Duration.days(1).toMilliseconds())

    for (const instanceName of this.app.getInstancesNames(InstanceType.Minecraft)) {
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
        const memberName =
          (await this.app.mojangApi.profileByUuid(member.uuid).catch(() => undefined))?.name ?? member.uuid

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

        writes.push(
          this.app.core.databaseManager.execute(
            `INSERT INTO "guildMemberEvents" (
              "instanceName", "memberUuid", "memberName", "eventType", "rank", "weeklyGexp", "dailyGexp", "online"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              instanceName,
              member.uuid,
              memberName,
              'snapshot',
              member.rank,
              member.weeklyExperience,
              sortedHistory[0]?.exp ?? 0,
              online ? 1 : 0
            ]
          )
        )

        writes.push(
          this.app.core.databaseManager.execute(
            `INSERT INTO "guildMemberDailySnapshots" (
              "snapshotDay", "instanceName", "memberUuid", "memberName", "joinedAt", "lastSeenAt", "weeklyGexp", "dailyGexp", "online"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT ("snapshotDay", "instanceName", "memberUuid") DO UPDATE SET
              "memberName" = EXCLUDED."memberName",
              "joinedAt" = EXCLUDED."joinedAt",
              "lastSeenAt" = EXCLUDED."lastSeenAt",
              "weeklyGexp" = EXCLUDED."weeklyGexp",
              "dailyGexp" = EXCLUDED."dailyGexp",
              "online" = EXCLUDED."online"`,
            [
              currentDay,
              instanceName,
              member.uuid,
              memberName,
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
          const [roles, members] = await Promise.all([
            guild.roles.fetch(),
            guild.members.fetch().catch(() => guild.members.cache)
          ])
          for (const role of roles.values()) {
            this.discordRoleMembers.set(
              { guild_id: guild.id, role_id: role.id, role_name: role.name },
              members.filter((member) => member.roles.cache.has(role.id)).size
            )
          }
        })().catch(() => undefined)
      )
    }

    await Promise.allSettled(tasks)
  }

  private async resolveOnlineProfiles(usernames: string[]): Promise<Map<string, string | undefined>> {
    return await this.app.mojangApi.profilesByUsername(new Set(usernames))
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
  }

  private async clean(): Promise<void> {
    const eventCutoff = Math.floor((Date.now() - GuildOnlineMetrics.EventRetention.toMilliseconds()) / 1000)
    const snapshotCutoffDay = Math.floor(
      (Date.now() - GuildOnlineMetrics.SnapshotRetention.toMilliseconds()) / Duration.days(1).toMilliseconds()
    )

    await this.app.core.databaseManager.enqueueWrite('cleaning guild member analytics', async (database) => {
      await database.query('DELETE FROM "guildMemberEvents" WHERE "createdAt" < $1', [eventCutoff])
      await database.query('DELETE FROM "guildMemberDailySnapshots" WHERE "snapshotDay" < $1', [snapshotCutoffDay])
    })
  }
}
