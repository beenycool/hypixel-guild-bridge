import assert from 'node:assert'

import type { InstanceType } from '../../common/application-event'
import { Status } from '../../common/connectable-instance'
import type { DatabaseManager } from '../../common/database-manager'
import SubInstance from '../../common/sub-instance'
import Duration from '../../utility/duration'
import { setIntervalAsync, setTimeoutAsync } from '../../utility/scheduling'
import type { Core } from '../core'

export default class Autocomplete extends SubInstance<Core, InstanceType.Core, void> {
  private static readonly MaxLife = Duration.years(1)
  private readonly pendingUsernames = new Map<string, Set<string>>()
  private readonly pendingRanks = new Map<string, Set<string>>()

  constructor(
    clientInstance: Core,
    private readonly databaseManager: DatabaseManager
  ) {
    super(clientInstance)

    this.application.on('chat', (event) => {
      this.recordPendingUsername(event.bridgeId, event.user.displayName())
    })
    this.application.on('guildPlayer', (event) => {
      this.recordPendingUsername(event.bridgeId, event.user.mojangProfile().name)
    })
    this.application.on('command', (event) => {
      this.recordPendingUsername(event.bridgeId, event.user.displayName())
    })
    this.application.on('commandFeedback', (event) => {
      this.recordPendingUsername(event.bridgeId, event.user.displayName())
    })

    setIntervalAsync(() => this.fetchGuildInfo(), {
      delay: Duration.seconds(300),
      errorHandler: this.errorHandler.promiseCatch('fetching guild info for autocomplete')
    })

    setIntervalAsync(
      () => {
        this.flushPending()
        return Promise.resolve()
      },
      {
        delay: Duration.seconds(30),
        errorHandler: this.errorHandler.promiseCatch('flushing pending autocomplete entries')
      }
    )

    const ranksResolver = setTimeoutAsync(async () => this.resolveGuildRanks(), {
      delay: Duration.seconds(10),
      errorHandler: this.errorHandler.promiseCatch('resolving guild ranks')
    })
    this.application.on('minecraftSelfBroadcast', (): void => {
      ranksResolver.refresh()
    })

    this.databaseManager.registerCleaner(() => {
      const oldestTimestamp = Math.floor((Date.now() - Autocomplete.MaxLife.toMilliseconds()) / 1000)

      this.databaseManager.enqueueTransaction('cleaning autocomplete entries', async (database) => {
        await database.query('DELETE FROM "autocompleteUsernames" WHERE "timestamp" < $1', [oldestTimestamp])
        await database.query('DELETE FROM "autocompleteRanks" WHERE "timestamp" < $1', [oldestTimestamp])
      })
    })

    this.application.addShutdownListener(() => {
      this.flushPending()
    })
  }

  public load(): Promise<void> {
    return Promise.resolve()
  }

  public async username(query: string, limit: number, bridgeId: string): Promise<string[]> {
    return await this.fetch('autocompleteUsernames', query, limit, bridgeId)
  }

  public async rank(query: string, limit: number, bridgeId: string): Promise<string[]> {
    return await this.fetch('autocompleteRanks', query, limit, bridgeId)
  }

  private recordPendingUsername(bridgeId: string | undefined, username: string): void {
    if (bridgeId === undefined) return

    let entries = this.pendingUsernames.get(bridgeId)
    if (entries === undefined) {
      entries = new Set()
      this.pendingUsernames.set(bridgeId, entries)
    }
    entries.add(username)
  }

  private flushPending(): void {
    const usernames = [...this.pendingUsernames.entries()]
    const ranks = [...this.pendingRanks.entries()]
    this.pendingUsernames.clear()
    this.pendingRanks.clear()

    for (const [bridgeId, entries] of usernames) {
      if (entries.size > 0) this.addUsernames(bridgeId, [...entries])
    }
    for (const [bridgeId, entries] of ranks) {
      if (entries.size > 0) this.addRanks(bridgeId, [...entries])
    }
  }

  private async fetch(
    table: 'autocompleteUsernames' | 'autocompleteRanks',
    query: string,
    limit: number,
    bridgeId: string
  ): Promise<string[]> {
    assert.ok(limit >= 1, 'limit must be 1 or greater')
    limit = Math.floor(limit)

    query = query.replaceAll(/[%_]/g, '').toLowerCase()

    const startsWithResult = await this.databaseManager.queryRows<{ content: string }>(
      `SELECT "content" FROM "${table}" WHERE "bridgeId" = $1 AND "loweredContent" LIKE $2 LIMIT $3`,
      [bridgeId, query + '%', limit]
    )

    const result = startsWithResult.map((row) => row.content)
    if (result.length >= limit) {
      return result
    }

    const containsResult = await this.databaseManager.queryRows<{ content: string }>(
      `SELECT "content" FROM "${table}"
       WHERE "bridgeId" = $1 AND "loweredContent" LIKE $2 AND "loweredContent" NOT LIKE $3
       LIMIT $4`,
      [bridgeId, '%' + query + '%', query + '%', limit - result.length]
    )

    return [...result, ...containsResult.map((row) => row.content)]
  }

  private addUsernames(bridgeId: string, usernames: string[]): void {
    this.add('autocompleteUsernames', usernames, bridgeId)
  }

  private addRanks(bridgeId: string, ranks: string[]): void {
    this.add('autocompleteRanks', ranks, bridgeId)
  }

  private add(table: 'autocompleteUsernames' | 'autocompleteRanks', entries: string[], bridgeId: string): void {
    const timestamp = Math.floor(Date.now() / 1000)
    const preparedEntries: { loweredContent: string; content: string; timestamp: number }[] = []

    for (const entry of entries) {
      const loweredContent = entry.toLowerCase().trim()
      preparedEntries.push({ loweredContent, content: entry.trim(), timestamp })
    }

    this.databaseManager.enqueueTransaction(`saving autocomplete ${table}`, async (database) => {
      for (const entry of preparedEntries) {
        await database.query(
          `INSERT INTO "${table}" ("bridgeId", "loweredContent", "content", "timestamp") VALUES ($1, $2, $3, $4)
           ON CONFLICT ("bridgeId", "loweredContent") DO UPDATE SET
             "content" = EXCLUDED."content",
             "timestamp" = EXCLUDED."timestamp"`,
          [bridgeId, entry.loweredContent, entry.content, entry.timestamp]
        )
      }
    })
  }

  private async fetchGuildInfo(): Promise<void> {
    for (const bridge of this.application.bridgeResolver.getAllBridges()) {
      const tasks = []
      const usernames: string[] = []
      const ranks: string[] = []

      for (const instance of this.application.minecraftManager.getAllInstances()) {
        if (instance.currentStatus() !== Status.Connected) continue
        if (this.application.bridgeResolver.getBridgeIdForInstance(instance.instanceName) !== bridge.id) continue

        const task = this.application.core.guildManager
          .list(instance.instanceName, Duration.minutes(1))
          .then((guild) => {
            for (const member of guild.members) {
              usernames.push(member.username)
              ranks.push(member.rank)
            }
          })
          .catch(() => undefined)

        tasks.push(task)
      }

      await Promise.all(tasks)

      this.addUsernames(bridge.id, usernames)
      this.addRanks(bridge.id, ranks)
    }
  }

  private async resolveGuildRanks(): Promise<void> {
    for (const bridge of this.application.bridgeResolver.getAllBridges()) {
      const guildsResolver = this.application.minecraftManager
        .getMinecraftBots()
        .filter((bot) => this.application.bridgeResolver.getBridgeIdForInstance(bot.instanceName) === bridge.id)
        .map((bot) => bot.uuid)
        .map((uuid) => this.application.hypixelApi.getGuild('player', uuid).catch(() => undefined))

      const guilds = await Promise.all(guildsResolver)
      const ranks: string[] = []
      for (const guild of guilds) {
        if (guild === undefined) continue

        for (const rank of guild.ranks) {
          ranks.push(rank.name)
        }
      }

      this.addRanks(bridge.id, ranks)
    }
  }
}
