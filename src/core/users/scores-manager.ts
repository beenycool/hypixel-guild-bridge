import assert from 'node:assert'

import PromiseQueue from 'promise-queue'

import type Application from '../../application'
import { ChannelType, InstanceType } from '../../common/application-event'
import { Status } from '../../common/connectable-instance'
import type { DatabaseManager } from '../../common/database-manager'
import SubInstance from '../../common/sub-instance'
import Duration from '../../utility/duration'
import { setIntervalAsync } from '../../utility/scheduling'
import type { Core } from '../core'

export default class ScoresManager extends SubInstance<Core, InstanceType.Core, void> {
  public static readonly DeleteMembersOlderThan = Duration.years(3)
  public static readonly DeleteMessagesOlderThan = Duration.years(3)
  public static readonly LeniencyTime = Duration.minutes(5)

  private static readonly InstantInterval = 60 * 1000
  private static readonly FetchMembersEvery = Duration.seconds(50)

  private static readonly ScoresExpireAt = Duration.minutes(1)

  private cachedPoints30Days: ActivityTotalPoints[] | undefined
  private lastUpdatePoints30Days = -1

  private cachedPointsAlltime: ActivityTotalPoints[] | undefined
  private lastUpdatePointsAlltime = -1

  private readonly queue = new PromiseQueue(1)
  private readonly database: ScoreDatabase

  constructor(
    clientInstance: Core,
    private readonly databaseManager: DatabaseManager
  ) {
    super(clientInstance)

    this.database = new ScoreDatabase(this, this.application, databaseManager)

    this.application.on('minecraftSelfBroadcast', (event) => {
      this.database.addBotUuid(event.uuid)
    })

    this.application.on('chat', (event) => {
      if (event.channelType !== ChannelType.Public) return

      switch (event.instanceType) {
        case InstanceType.Discord: {
          this.database.addDiscordMessage(event.user.discordProfile().id, this.timestamp())
          break
        }
        case InstanceType.Minecraft: {
          this.database.addMinecraftMessage(event.user.mojangProfile().id, this.timestamp())
        }
      }
    })

    this.application.on('command', (event) => {
      if (event.channelType !== ChannelType.Public) return

      switch (event.instanceType) {
        case InstanceType.Discord: {
          const profile = event.user.discordProfile()
          this.database.addDiscordCommand(profile.id, this.timestamp())
          break
        }
        case InstanceType.Minecraft: {
          const profile = event.user.mojangProfile()
          this.database.addMinecraftCommand(profile.id, this.timestamp())
        }
      }
    })

    setIntervalAsync(() => this.queue.add(() => this.fetchGuilds()), {
      delay: Duration.minutes(30),
      errorHandler: this.errorHandler.promiseCatch('fetching guilds')
    })

    setIntervalAsync(() => this.queue.add(() => this.fetchMembers()), {
      delay: ScoresManager.FetchMembersEvery,
      errorHandler: this.errorHandler.promiseCatch('fetching and adding members')
    })

    setIntervalAsync(() => this.migrateUsernames(), {
      delay: Duration.minutes(30),
      errorHandler: this.errorHandler.promiseCatch('migrating Mojang usernames to UUID')
    })
  }

  public async load(): Promise<void> {
    await this.database.load()
  }

  public getMessages30Days(): TotalMessagesLeaderboard[] {
    const currentDate = Date.now()
    const ignores = this.database.getBotUuids()
    return this.database.getGuildMessagesLeaderboard(ignores, currentDate - 30 * 24 * 60 * 60 * 1000, currentDate)
  }

  public getMinecraftMessages30Days(limit: number): { top: MessagesLeaderboard[]; total: number } {
    const currentDate = Date.now()
    const ignores = this.database.getBotUuids()
    return this.database.getMinecraftMessages(ignores, currentDate - 30 * 24 * 60 * 60 * 1000, currentDate, limit)
  }

  public getDiscordMessages30Days(userIds: string[]): MessagesLeaderboard[] {
    const currentDate = Date.now()
    return this.database.getDiscordMessages(userIds, currentDate - 30 * 24 * 60 * 60 * 1000, currentDate)
  }

  public getOnline30Days(): MemberLeaderboard[] {
    const currentDate = Date.now()
    const ignores = this.database.getBotUuids()
    return this.database.getTime('OnlineMembers', ignores, currentDate - 30 * 24 * 60 * 60 * 1000, currentDate)
  }

  public getPoints30Days(): ActivityTotalPoints[] {
    if (
      this.cachedPoints30Days !== undefined &&
      this.lastUpdatePoints30Days + ScoresManager.ScoresExpireAt.toMilliseconds() > Date.now()
    ) {
      return this.cachedPoints30Days
    }

    const currentDate = Date.now()
    const points = this.database.getPoints(currentDate - Duration.days(30).toMilliseconds(), currentDate)
    const leaderboard = this.normalizePoints(points)

    this.cachedPoints30Days = leaderboard
    this.lastUpdatePoints30Days = Date.now()

    return leaderboard
  }

  public getPointsAlltime(): ActivityTotalPoints[] {
    if (
      this.cachedPointsAlltime !== undefined &&
      this.lastUpdatePointsAlltime + ScoresManager.ScoresExpireAt.toMilliseconds() > Date.now()
    ) {
      return this.cachedPointsAlltime
    }

    const points = this.database.getPoints(0, Date.now())
    const leaderboard = this.normalizePoints(points)

    this.cachedPointsAlltime = leaderboard
    this.lastUpdatePointsAlltime = Date.now()

    return leaderboard
  }

  private normalizePoints(points: Map<string, ActivityTotalPoints>): ActivityTotalPoints[] {
    for (const minecraftBotUuid of this.database.getBotUuids()) {
      points.delete(minecraftBotUuid)
    }
    for (const minecraftBot of this.application.minecraftManager.getMinecraftBots()) {
      points.delete(minecraftBot.uuid)
    }

    const leaderboard = points.values().toArray()
    for (const currentScore of leaderboard) {
      currentScore.total = Math.floor(currentScore.total)
    }
    leaderboard.sort((a, b) => b.total - a.total)

    return leaderboard
  }

  private async fetchGuilds(): Promise<void> {
    for (const instance of this.application.minecraftManager.getAllInstances()) {
      const botUuid = instance.uuid()
      if (botUuid === undefined) continue
      this.logger.trace(`Fetching guild members for bot uuid ${botUuid}`)

      const guild = await this.application.hypixelApi.getGuild('player', botUuid)
      const timeframes: Timeframe[] = []
      const currentTimestamp = Date.now()
      for (const member of guild.members) {
        timeframes.push({
          uuid: member.uuid,
          fromTimestamp: member.joinedAtTimestamp,
          toTimestamp: currentTimestamp,
          leniencyMilliseconds: ScoresManager.LeniencyTime.toMilliseconds()
        })
      }
      this.logger.trace(`Supplementing ${timeframes.length} guild members timeframe data for bot uuid ${botUuid}`)
      this.database.addMembers(timeframes)
    }
  }

  private async fetchMembers(): Promise<void> {
    const instances = this.application.minecraftManager.getAllInstances()
    for (const bot of this.application.minecraftManager.getMinecraftBots()) {
      this.database.addBotUuid(bot.uuid)
    }

    const tasks: Promise<unknown>[] = []

    for (const instance of instances) {
      const botUuid = instance.uuid()
      if (botUuid !== undefined) this.database.addBotUuid(botUuid)

      if (instance.currentStatus() === Status.Connected) {
        const onlineTask = this.application.core.guildManager
          .list(instance.instanceName)
          .then((guild) => guild.members.filter((member) => member.online).map((member) => member.username))
          .then((usernames) => this.application.mojangApi.profilesByUsername(new Set(usernames)))
          .then((profiles) => {
            const uuids = [...profiles.values()].filter((uuid) => uuid !== undefined)
            const currentTime = Date.now()
            const entries: Timeframe[] = uuids.map((uuid) => ({
              uuid: uuid,
              fromTimestamp: currentTime,
              toTimestamp: currentTime,
              leniencyMilliseconds: ScoresManager.LeniencyTime.toMilliseconds()
            }))
            this.database.addOnlineMembers(entries)
          })
          .catch(this.errorHandler.promiseCatch('fetching and adding online members'))

        const allTask = this.application.core.guildManager
          .list(instance.instanceName)
          .then((guild) => guild.members.map((member) => member.username))
          .then((usernames) => this.application.mojangApi.profilesByUsername(new Set(usernames)))
          .then((profiles) => {
            const uuids = [...profiles.values()].filter((uuid) => uuid !== undefined)
            const currentTime = Date.now()
            const entries: Timeframe[] = uuids.map((uuid) => ({
              uuid: uuid,
              fromTimestamp: currentTime,
              toTimestamp: currentTime,
              leniencyMilliseconds: ScoresManager.LeniencyTime.toMilliseconds()
            }))
            this.database.addMembers(entries)
          })
          .catch(this.errorHandler.promiseCatch('fetching and adding all members'))

        tasks.push(onlineTask, allTask)
      }
    }

    await Promise.all(tasks)
  }

  private async migrateUsernames(): Promise<void> {
    /**
     * Only migrate from the last 30 days since Mojang locks username for up to 30 days before releasing it to the public
     * Within 30 days period, there won't be conflict between players UUID
     */
    const oldestTimestamp = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60

    const usernames = this.database.getLegacyUsernames(oldestTimestamp)
    if (usernames.size === 0) return
    this.logger.debug(`Found ${usernames.size} legacy username that requires migration`)

    const resolvedProfiles = await this.application.mojangApi.profilesByUsername(usernames)
    const entries: { username: string; uuid: string }[] = []
    for (const [username, uuid] of resolvedProfiles.entries()) {
      if (uuid === undefined) continue
      entries.push({ username, uuid })
    }

    if (entries.length < usernames.size) {
      this.logger.debug(`No Mojang information found for ${usernames.size - entries.length} username. Skipping those.`)
    }

    const changedCount = this.database.migrateUsernameToUuid(oldestTimestamp, entries)
    if (changedCount > 0) {
      this.logger.debug(`Migrated ${changedCount} database entry from Mojang username to UUID`)
    }
  }

  private timestamp(): number {
    const currentTime = Date.now()
    const remaining = currentTime % ScoresManager.InstantInterval
    return currentTime - remaining
  }
}

class ScoreDatabase {
  private readonly minecraftCommands = new Map<string, CountEntry>()
  private readonly discordCommands = new Map<string, CountEntry>()
  private readonly minecraftMessages = new Map<string, CountEntry>()
  private readonly discordMessages = new Map<string, CountEntry>()
  private readonly allMembers: TimeframeRecord[] = []
  private readonly onlineMembers: TimeframeRecord[] = []
  private readonly minecraftBots = new Map<string, { uuid: string; updatedAt: number; createdAt: number }>()
  private nextAllMembersId = 1
  private nextOnlineMembersId = 1

  constructor(
    private readonly scoresManager: ScoresManager,
    private readonly application: Application,
    private readonly databaseManager: DatabaseManager
  ) {
    databaseManager.registerCleaner(() => {
      this.clean()
    })
  }

  public async load(): Promise<void> {
    const [
      minecraftCommands,
      discordCommands,
      minecraftMessages,
      discordMessages,
      allMembers,
      onlineMembers,
      minecraftBots
    ] = await Promise.all([
      this.databaseManager.queryRows<CountEntry>('SELECT * FROM "MinecraftCommands"'),
      this.databaseManager.queryRows<CountEntry>('SELECT * FROM "DiscordCommands"'),
      this.databaseManager.queryRows<CountEntry>('SELECT * FROM "MinecraftMessages"'),
      this.databaseManager.queryRows<CountEntry>('SELECT * FROM "DiscordMessages"'),
      this.databaseManager.queryRows<TimeframeRecord>('SELECT * FROM "AllMembers" ORDER BY "id" ASC'),
      this.databaseManager.queryRows<TimeframeRecord>('SELECT * FROM "OnlineMembers" ORDER BY "id" ASC'),
      this.databaseManager.queryRows<{ uuid: string; updatedAt: number; createdAt: number }>(
        'SELECT * FROM "minecraftBots"'
      )
    ])

    this.replaceCountTable(this.minecraftCommands, minecraftCommands)
    this.replaceCountTable(this.discordCommands, discordCommands)
    this.replaceCountTable(this.minecraftMessages, minecraftMessages)
    this.replaceCountTable(this.discordMessages, discordMessages)

    this.allMembers.length = 0
    this.allMembers.push(...allMembers)
    let maxAllMembersId = 0
    for (const entry of allMembers) {
      if (entry.id > maxAllMembersId) maxAllMembersId = entry.id
    }
    this.nextAllMembersId = maxAllMembersId + 1

    this.onlineMembers.length = 0
    this.onlineMembers.push(...onlineMembers)
    let maxOnlineMembersId = 0
    for (const entry of onlineMembers) {
      if (entry.id > maxOnlineMembersId) maxOnlineMembersId = entry.id
    }
    this.nextOnlineMembersId = maxOnlineMembersId + 1

    this.minecraftBots.clear()
    for (const entry of minecraftBots) {
      this.minecraftBots.set(entry.uuid, entry)
    }
  }

  public addMinecraftCommand(uuid: string, timestamp: number): void {
    this.incrementCount(this.minecraftCommands, 'MinecraftCommands', uuid, timestamp)
  }

  public addDiscordCommand(id: string, timestamp: number): void {
    this.incrementCount(this.discordCommands, 'DiscordCommands', id, timestamp)
  }

  public addMinecraftMessage(uuid: string, timestamp: number): void {
    this.incrementCount(this.minecraftMessages, 'MinecraftMessages', uuid, timestamp)
  }

  public getMinecraftMessages(
    ignore: string[],
    from: number,
    to: number,
    limit: number
  ): {
    top: MessagesLeaderboard[]
    total: number
  } {
    const ignoreSet = new Set(ignore)
    const leaderboard = new Map<string, number>()
    let total = 0

    for (const entry of this.filterCounts(this.minecraftMessages, from, to)) {
      if (ignoreSet.has(entry.user)) continue
      total += entry.count
      leaderboard.set(entry.user, (leaderboard.get(entry.user) ?? 0) + entry.count)
    }

    const top = [...leaderboard.entries()]
      .map(([user, totalCount]) => ({ user, total: totalCount }))
      .toSorted((a, b) => b.total - a.total)
      .slice(0, limit)

    return { top, total }
  }

  public getDiscordMessages(userIds: string[], from: number, to: number): MessagesLeaderboard[] {
    const userIdSet = new Set(userIds)
    const leaderboard = new Map<string, number>()

    for (const entry of this.filterCounts(this.discordMessages, from, to)) {
      if (!userIdSet.has(entry.user)) continue
      leaderboard.set(entry.user, (leaderboard.get(entry.user) ?? 0) + entry.count)
    }

    return [...leaderboard.entries()].map(([user, total]) => ({ user, total })).toSorted((a, b) => b.total - a.total)
  }

  public getGuildMessagesLeaderboard(ignore: string[], from: number, to: number): TotalMessagesLeaderboard[] {
    const ignoreSet = new Set(ignore)
    const { discordToUuid, uuidToDiscord } = this.getLinkMaps()
    const leaderboard = new Map<string, TotalMessagesLeaderboard>()

    for (const entry of this.filterCounts(this.minecraftMessages, from, to)) {
      if (ignoreSet.has(entry.user)) continue
      const record = getOrCreateTotalLeaderboard(leaderboard, entry.user, uuidToDiscord.get(entry.user))
      record.count += entry.count
    }

    for (const entry of this.filterCounts(this.discordMessages, from, to)) {
      const uuid = discordToUuid.get(entry.user)
      if (uuid === undefined || ignoreSet.has(uuid)) continue
      const record = getOrCreateTotalLeaderboard(leaderboard, uuid, entry.user)
      record.count += entry.count
    }

    return [...leaderboard.values()].toSorted((a, b) => b.count - a.count)
  }

  public getTime(
    table: 'allMembers' | 'OnlineMembers',
    ignore: string[],
    from: number,
    to: number
  ): MemberLeaderboard[] {
    assert.ok(from < to, '"from" timestamp is earlier than the "to" timestamp')

    const ignoreSet = new Set(ignore)
    const { uuidToDiscord } = this.getLinkMaps()
    const fromSeconds = Math.floor(from / 1000)
    const toSeconds = Math.floor(to / 1000)
    const source = table === 'allMembers' ? this.allMembers : this.onlineMembers

    const leaderboard = new Map<string, MemberLeaderboard>()
    for (const entry of source) {
      if (ignoreSet.has(entry.uuid)) continue
      if (entry.toTimestamp < fromSeconds || entry.fromTimestamp > toSeconds) continue

      const duration = Math.min(toSeconds, entry.toTimestamp) - Math.max(fromSeconds, entry.fromTimestamp)
      if (duration < 0) continue

      const current = leaderboard.get(entry.uuid) ?? {
        uuid: entry.uuid,
        discordId: uuidToDiscord.get(entry.uuid),
        totalTime: 0
      }
      current.totalTime += duration
      leaderboard.set(entry.uuid, current)
    }

    return [...leaderboard.values()].toSorted((a, b) => b.totalTime - a.totalTime)
  }

  public addDiscordMessage(id: string, timestamp: number): void {
    this.incrementCount(this.discordMessages, 'DiscordMessages', id, timestamp)
  }

  public addOnlineMembers(entries: Timeframe[]): void {
    this.appendTimeframe('OnlineMembers', entries)
  }

  public addMembers(entries: Timeframe[]): void {
    this.appendTimeframe('AllMembers', entries)
  }

  private appendTimeframe(tableName: 'AllMembers' | 'OnlineMembers', entries: Timeframe[]): void {
    const target = tableName === 'AllMembers' ? this.allMembers : this.onlineMembers
    const operations: { deletedIds: number[]; inserted?: TimeframeRecord }[] = []

    for (const entry of entries) {
      const fromTimestamp = Math.floor(entry.fromTimestamp / 1000)
      const toTimestamp = Math.floor(entry.toTimestamp / 1000)
      const leniencySeconds = Math.floor(entry.leniencyMilliseconds / 1000)

      const existingFrames = target.filter(
        (frame) =>
          frame.uuid === entry.uuid &&
          ((frame.fromTimestamp > toTimestamp && frame.fromTimestamp - toTimestamp <= leniencySeconds) ||
            (frame.toTimestamp < fromTimestamp && fromTimestamp - frame.toTimestamp <= leniencySeconds) ||
            (frame.fromTimestamp >= fromTimestamp && frame.fromTimestamp <= toTimestamp) ||
            (frame.toTimestamp >= fromTimestamp && frame.toTimestamp <= toTimestamp) ||
            (frame.fromTimestamp <= fromTimestamp && frame.toTimestamp >= toTimestamp))
      )

      let inserted: TimeframeRecord
      if (existingFrames.length > 0) {
        const deletedIds = existingFrames.map((frame) => frame.id)
        removeByIds(target, deletedIds)

        let lowestTime = Math.min(existingFrames[0].fromTimestamp, fromTimestamp)
        let highestTime = Math.max(existingFrames[0].toTimestamp, toTimestamp)
        for (const frame of existingFrames) {
          if (frame.fromTimestamp < lowestTime) lowestTime = frame.fromTimestamp
          if (frame.toTimestamp > highestTime) highestTime = frame.toTimestamp
        }

        inserted = this.createTimeframeRecord(tableName, entry.uuid, lowestTime, highestTime)
        operations.push({ deletedIds, inserted })
      } else {
        inserted = this.createTimeframeRecord(tableName, entry.uuid, fromTimestamp, toTimestamp)
        operations.push({ deletedIds: [], inserted })
      }

      target.push(inserted)
    }

    this.databaseManager.enqueueTransaction(`saving ${tableName} timeframes`, async (database) => {
      for (const operation of operations) {
        if (operation.deletedIds.length > 0) {
          await database.query(`DELETE FROM "${tableName}" WHERE "id" = ANY($1::int[])`, [operation.deletedIds])
        }
        if (operation.inserted !== undefined) {
          await database.query(
            `INSERT INTO "${tableName}" ("id", "uuid", "fromTimestamp", "toTimestamp") VALUES ($1, $2, $3, $4)`,
            [
              operation.inserted.id,
              operation.inserted.uuid,
              operation.inserted.fromTimestamp,
              operation.inserted.toTimestamp
            ]
          )
        }
      }
    })
  }

  private getMessagesPoints(from: number, to: number): Map<string, ActivityPoint> {
    const allEntries = this.collectLinkedCountEntries(this.minecraftMessages, this.discordMessages, from, to)
    return this.calculateCount(allEntries, 30, Duration.minutes(3))
  }

  private getCommandsPoints(from: number, to: number): Map<string, ActivityPoint> {
    const allEntries = this.collectLinkedCountEntries(this.minecraftCommands, this.discordCommands, from, to)
    return this.calculateCount(allEntries, 15, Duration.minutes(5))
  }

  private calculateCount(
    allEntries: DatabaseCountEntry[],
    baseScore: number,
    scoreMaxHistory: Duration
  ): Map<string, ActivityPoint> {
    allEntries.sort((a, b) => a.timestamp - b.timestamp)

    const leaderboard = new Map<string, ActivityPoint>()
    const countHistory = new Map<string, number[]>()

    for (const entry of allEntries) {
      let activityEntry = leaderboard.get(entry.uuid)
      if (activityEntry === undefined) {
        activityEntry = { uuid: entry.uuid, discordId: entry.discordId ?? undefined, points: 0 }
        leaderboard.set(entry.uuid, activityEntry)
      }
      activityEntry.discordId ??= entry.discordId ?? undefined

      let countHistoryEntry = countHistory.get(entry.uuid)
      if (countHistoryEntry === undefined) {
        countHistoryEntry = []
        countHistory.set(entry.uuid, countHistoryEntry)
      } else {
        countHistoryEntry = countHistoryEntry.filter(
          (historyTimestamp) => historyTimestamp + scoreMaxHistory.toSeconds() > entry.timestamp
        )
        countHistory.set(entry.uuid, countHistoryEntry)
      }

      for (let counter = 0; counter < entry.count; counter++) {
        countHistoryEntry.push(entry.timestamp)
        activityEntry.points += Math.max(1, baseScore / countHistoryEntry.length)
      }
    }

    return leaderboard
  }

  private getOnlinePoints(from: number, to: number): Map<string, ActivityPoint> {
    const { uuidToDiscord } = this.getLinkMaps()
    const timeframes = this.onlineMembers
      .filter((entry) => !(entry.toTimestamp * 1000 < from || entry.fromTimestamp * 1000 > to))
      .map((entry) => ({
        uuid: entry.uuid,
        discordId: uuidToDiscord.get(entry.uuid),
        fromTimestamp: entry.fromTimestamp,
        toTimestamp: entry.toTimestamp
      }))
      .toSorted((a, b) => a.fromTimestamp - b.fromTimestamp)

    const baseScore = 15
    const scoreCooldown = Duration.minutes(15).toSeconds()
    const leaderboard = new Map<string, ActivityPoint>()
    const reachedTimestamps = new Map<string, number>()

    for (const entry of timeframes) {
      entry.fromTimestamp = Math.max(entry.fromTimestamp, Math.floor(from / 1000))
      entry.toTimestamp = Math.min(entry.toTimestamp, Math.floor(to / 1000))

      let user = leaderboard.get(entry.uuid)
      if (user === undefined) {
        user = { uuid: entry.uuid, discordId: entry.discordId ?? undefined, points: 0 }
        leaderboard.set(entry.uuid, user)
      }
      user.discordId ??= entry.discordId ?? undefined

      let reachedTimestamp = reachedTimestamps.get(entry.uuid)
      if (entry.toTimestamp < (reachedTimestamp ?? 0)) continue

      if (reachedTimestamp === undefined) {
        reachedTimestamp = entry.fromTimestamp
      } else if (reachedTimestamp < entry.fromTimestamp) {
        if (reachedTimestamp + scoreCooldown > entry.toTimestamp) {
          continue
        }
        reachedTimestamp += scoreCooldown
      } else {
        reachedTimestamp = Math.max(reachedTimestamp, entry.fromTimestamp)
      }

      for (; reachedTimestamp <= entry.toTimestamp; reachedTimestamp += scoreCooldown) {
        user.points += baseScore
      }

      reachedTimestamps.set(entry.uuid, reachedTimestamp)
    }

    return leaderboard
  }

  public getPoints(from: number, to: number): Map<string, ActivityTotalPoints> {
    assert.ok(from < to, '"from" timestamp must be earlier than the "to" timestamp')

    const leaderboard = new Map<string, ActivityTotalPoints>()
    const getUser = (entry: ActivityPoint) => {
      let user = leaderboard.get(entry.uuid)
      if (user === undefined) {
        user = {
          uuid: entry.uuid,
          discordId: entry.discordId ?? undefined,
          total: 0,
          chat: 0,
          online: 0,
          commands: 0
        }
        leaderboard.set(entry.uuid, user)
      }
      user.discordId ??= entry.discordId ?? undefined
      return user
    }

    for (const entry of this.getMessagesPoints(from, to).values()) {
      const user = getUser(entry)
      const points = Math.floor(entry.points)
      user.total += points
      user.chat += points
    }
    for (const entry of this.getCommandsPoints(from, to).values()) {
      const user = getUser(entry)
      const points = Math.floor(entry.points)
      user.total += points
      user.commands += points
    }
    for (const entry of this.getOnlinePoints(from, to).values()) {
      const user = getUser(entry)
      const points = Math.floor(entry.points)
      user.total += points
      user.online += points
    }

    return leaderboard
  }

  public getLegacyUsernames(oldestTimestamp: number): Set<string> {
    const result = new Set<string>()
    for (const entry of this.minecraftMessages.values()) {
      if (entry.timestamp > oldestTimestamp && entry.user.length < 30) {
        result.add(entry.user)
      }
    }
    return result
  }

  public migrateUsernameToUuid(oldestTimestamp: number, entries: { username: string; uuid: string }[]): number {
    let count = 0
    const usernamesToDelete: string[] = []
    const affected = new Set<string>()

    for (const entry of entries) {
      usernamesToDelete.push(entry.username)
      for (const countEntry of this.minecraftMessages.values()) {
        if (countEntry.user !== entry.username || countEntry.timestamp <= oldestTimestamp) continue
        count += countEntry.count

        this.minecraftMessages.delete(countKey(countEntry.timestamp, countEntry.user))
        const key = countKey(countEntry.timestamp, entry.uuid)
        const existing = this.minecraftMessages.get(key)
        if (existing === undefined) {
          this.minecraftMessages.set(key, {
            timestamp: countEntry.timestamp,
            user: entry.uuid,
            count: countEntry.count
          })
        } else {
          existing.count += countEntry.count
        }
        affected.add(key)
      }
    }

    if (count > 0) {
      const upserts = [...affected].map((key) => this.minecraftMessages.get(key)).filter((entry) => entry !== undefined)
      this.databaseManager.enqueueTransaction('migrating legacy minecraft usernames', async (database) => {
        for (const username of usernamesToDelete) {
          await database.query('DELETE FROM "MinecraftMessages" WHERE "user" = $1 AND "timestamp" > $2', [
            username,
            oldestTimestamp
          ])
        }
        for (const entry of upserts) {
          await database.query(
            `INSERT INTO "MinecraftMessages" ("timestamp", "user", "count") VALUES ($1, $2, $3)
             ON CONFLICT ("timestamp", "user") DO UPDATE SET "count" = EXCLUDED."count"`,
            [entry.timestamp, entry.user, entry.count]
          )
        }
      })
    }

    return count
  }

  public getBotUuids(): string[] {
    return [...this.minecraftBots.keys()]
  }

  public addBotUuid(uuid: string): void {
    const now = Math.floor(Date.now() / 1000)
    const existing = this.minecraftBots.get(uuid)
    this.minecraftBots.set(uuid, { uuid, updatedAt: now, createdAt: existing?.createdAt ?? now })

    this.databaseManager.enqueueWrite(`saving minecraft bot ${uuid}`, async (database) => {
      await database.query(
        `INSERT INTO "minecraftBots" ("uuid", "updatedAt", "createdAt") VALUES ($1, $2, $3)
         ON CONFLICT ("uuid") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"`,
        [uuid, now, existing?.createdAt ?? now]
      )
    })
  }

  public clean(): number {
    const currentTime = Math.floor(Date.now() / 1000)
    const oldestMessageTimestamp = currentTime - ScoresManager.DeleteMessagesOlderThan.toSeconds()
    const oldestMemberTimestamp = currentTime - ScoresManager.DeleteMembersOlderThan.toSeconds()

    let count = 0
    count += this.removeOldCounts(this.minecraftMessages, oldestMessageTimestamp)
    count += this.removeOldCounts(this.discordMessages, oldestMessageTimestamp)
    count += this.removeOldCounts(this.minecraftCommands, oldestMessageTimestamp)
    count += this.removeOldCounts(this.discordCommands, oldestMessageTimestamp)
    count += removeOldTimeframes(this.allMembers, oldestMemberTimestamp)
    count += removeOldTimeframes(this.onlineMembers, oldestMemberTimestamp)

    if (count > 0) {
      this.databaseManager.enqueueTransaction('cleaning scores data', async (database) => {
        await database.query('DELETE FROM "MinecraftMessages" WHERE "timestamp" < $1', [oldestMessageTimestamp])
        await database.query('DELETE FROM "DiscordMessages" WHERE "timestamp" < $1', [oldestMessageTimestamp])
        await database.query('DELETE FROM "MinecraftCommands" WHERE "timestamp" < $1', [oldestMessageTimestamp])
        await database.query('DELETE FROM "DiscordCommands" WHERE "timestamp" < $1', [oldestMessageTimestamp])
        await database.query('DELETE FROM "AllMembers" WHERE "toTimestamp" < $1', [oldestMemberTimestamp])
        await database.query('DELETE FROM "OnlineMembers" WHERE "toTimestamp" < $1', [oldestMemberTimestamp])
      })
    }

    return count
  }

  private incrementCount(
    table: Map<string, CountEntry>,
    tableName: CountTableName,
    user: string,
    timestamp: number
  ): void {
    const seconds = Math.floor(timestamp / 1000)
    const key = countKey(seconds, user)
    const entry = table.get(key)
    if (entry === undefined) {
      table.set(key, { timestamp: seconds, user, count: 1 })
    } else {
      entry.count++
    }

    this.databaseManager.enqueueWrite(`incrementing ${tableName} for ${user}`, async (database) => {
      await database.query(
        `INSERT INTO "${tableName}" ("timestamp", "user", "count") VALUES ($1, $2, 1)
         ON CONFLICT ("timestamp", "user") DO UPDATE SET "count" = "${tableName}"."count" + 1`,
        [seconds, user]
      )
    })
  }

  private filterCounts(table: Map<string, CountEntry>, from: number, to: number): CountEntry[] {
    const fromSeconds = Math.floor(from / 1000)
    const toSeconds = Math.floor(to / 1000)
    return [...table.values()].filter((entry) => entry.timestamp >= fromSeconds && entry.timestamp <= toSeconds)
  }

  private collectLinkedCountEntries(
    minecraftTable: Map<string, CountEntry>,
    discordTable: Map<string, CountEntry>,
    from: number,
    to: number
  ): DatabaseCountEntry[] {
    const { discordToUuid, uuidToDiscord } = this.getLinkMaps()
    const result: DatabaseCountEntry[] = []

    for (const entry of this.filterCounts(minecraftTable, from, to)) {
      result.push({
        uuid: entry.user,
        discordId: uuidToDiscord.get(entry.user) ?? undefined,
        count: entry.count,
        timestamp: entry.timestamp
      })
    }

    for (const entry of this.filterCounts(discordTable, from, to)) {
      const uuid = discordToUuid.get(entry.user)
      if (uuid === undefined) continue

      result.push({
        uuid,
        discordId: entry.user,
        count: entry.count,
        timestamp: entry.timestamp
      })
    }

    return result
  }

  private getLinkMaps(): { uuidToDiscord: Map<string, string>; discordToUuid: Map<string, string> } {
    const uuidToDiscord = new Map<string, string>()
    const discordToUuid = new Map<string, string>()
    for (const link of this.application.core.verification.getAllLinks()) {
      uuidToDiscord.set(link.uuid, link.discordId)
      discordToUuid.set(link.discordId, link.uuid)
    }
    return { uuidToDiscord, discordToUuid }
  }

  private createTimeframeRecord(
    tableName: 'AllMembers' | 'OnlineMembers',
    uuid: string,
    fromTimestamp: number,
    toTimestamp: number
  ): TimeframeRecord {
    if (tableName === 'AllMembers') {
      return { id: this.nextAllMembersId++, uuid, fromTimestamp, toTimestamp }
    }
    return { id: this.nextOnlineMembersId++, uuid, fromTimestamp, toTimestamp }
  }

  private replaceCountTable(target: Map<string, CountEntry>, rows: CountEntry[]): void {
    target.clear()
    for (const row of rows) {
      target.set(countKey(row.timestamp, row.user), row)
    }
  }

  private removeOldCounts(table: Map<string, CountEntry>, cutoff: number): number {
    let deleted = 0
    for (const [key, entry] of table) {
      if (entry.timestamp < cutoff) {
        table.delete(key)
        deleted++
      }
    }
    return deleted
  }
}

type CountTableName = 'MinecraftCommands' | 'DiscordCommands' | 'MinecraftMessages' | 'DiscordMessages'

interface CountEntry {
  timestamp: number
  user: string
  count: number
}

interface TimeframeRecord {
  id: number
  uuid: string
  fromTimestamp: number
  toTimestamp: number
}

function countKey(timestamp: number, user: string): string {
  return `${timestamp}:${user}`
}

function removeByIds(entries: TimeframeRecord[], ids: number[]): void {
  const idSet = new Set(ids)
  for (let index = entries.length - 1; index >= 0; index--) {
    if (idSet.has(entries[index].id)) {
      entries.splice(index, 1)
    }
  }
}

function removeOldTimeframes(entries: TimeframeRecord[], cutoff: number): number {
  let deleted = 0
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].toTimestamp < cutoff) {
      entries.splice(index, 1)
      deleted++
    }
  }
  return deleted
}

function getOrCreateTotalLeaderboard(
  leaderboard: Map<string, TotalMessagesLeaderboard>,
  uuid: string,
  discordId: string | undefined
): TotalMessagesLeaderboard {
  let object = leaderboard.get(uuid)
  if (object === undefined) {
    object = { uuid, discordId, count: 0 }
    leaderboard.set(uuid, object)
  }
  object.discordId ??= discordId
  return object
}

interface Timeframe {
  uuid: string
  fromTimestamp: number
  toTimestamp: number
  leniencyMilliseconds: number
}

interface MessagesLeaderboard {
  user: string
  total: number
}

interface TotalMessagesLeaderboard {
  uuid: string
  count: number
  discordId: string | undefined
}

interface MemberLeaderboard {
  uuid: string
  totalTime: number
  discordId: string | undefined
}

interface DatabaseCountEntry {
  uuid: string
  count: number
  discordId: string | undefined
  timestamp: number
}

export interface ActivityPoint {
  uuid: string
  discordId: string | undefined
  points: number
}

export interface ActivityTotalPoints {
  uuid: string
  discordId: string | undefined

  total: number
  commands: number
  chat: number
  online: number
}
