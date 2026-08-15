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
  private readonly pendingUsernames = new Set<string>()
  private readonly pendingRanks = new Set<string>()

  constructor(
    clientInstance: Core,
    private readonly databaseManager: DatabaseManager
  ) {
    super(clientInstance)

    this.application.on('chat', (event) => {
      this.pendingUsernames.add(event.user.displayName())
    })
    this.application.on('guildPlayer', (event) => {
      this.pendingUsernames.add(event.user.mojangProfile().name)
    })
    this.application.on('command', (event) => {
      this.pendingUsernames.add(event.user.displayName())
    })
    this.application.on('commandFeedback', (event) => {
      this.pendingUsernames.add(event.user.displayName())
    })

    setIntervalAsync(() => this.fetchGuildInfo(), {
      delay: Duration.seconds(300),
      errorHandler: this.errorHandler.promiseCatch('fetching guild info for autocomplete')
    })

    setIntervalAsync(
      () => {
        const usernames = [...this.pendingUsernames]
        const ranks = [...this.pendingRanks]
        this.pendingUsernames.clear()
        this.pendingRanks.clear()
        if (usernames.length > 0) this.addUsernames(usernames)
        if (ranks.length > 0) this.addRanks(ranks)
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
      const usernames = [...this.pendingUsernames]
      const ranks = [...this.pendingRanks]
      if (usernames.length > 0 || ranks.length > 0) {
        if (usernames.length > 0) this.addUsernames(usernames)
        if (ranks.length > 0) this.addRanks(ranks)
      }
    })
  }

  public async load(): Promise<void> {
    // No longer loading into RAM to prevent memory issues
  }

  public async username(query: string, limit: number): Promise<string[]> {
    return await this.fetch('autocompleteUsernames', query, limit)
  }

  public async rank(query: string, limit: number): Promise<string[]> {
    return await this.fetch('autocompleteRanks', query, limit)
  }

  private async fetch(
    table: 'autocompleteUsernames' | 'autocompleteRanks',
    query: string,
    limit: number
  ): Promise<string[]> {
    assert.ok(limit >= 1, 'limit must be 1 or greater')
    limit = Math.floor(limit)

    query = query.replaceAll(/[%_]/g, '').toLowerCase()

    const startsWithResult = await this.databaseManager.queryRows<{ content: string }>(
      `SELECT "content" FROM "${table}" WHERE "loweredContent" LIKE $1 LIMIT $2`,
      [query + '%', limit]
    )

    const result = startsWithResult.map((row) => row.content)
    if (result.length >= limit) {
      return result
    }

    const containsResult = await this.databaseManager.queryRows<{ content: string }>(
      `SELECT "content" FROM "${table}" WHERE "loweredContent" LIKE $1 AND "loweredContent" NOT LIKE $2 LIMIT $3`,
      ['%' + query + '%', query + '%', limit - result.length]
    )

    return [...result, ...containsResult.map((row) => row.content)]
  }

  private addUsernames(usernames: string[]): void {
    this.add('autocompleteUsernames', usernames)
  }

  private addRanks(ranks: string[]): void {
    this.add('autocompleteRanks', ranks)
  }

  private add(table: 'autocompleteUsernames' | 'autocompleteRanks', entries: string[]): void {
    const timestamp = Math.floor(Date.now() / 1000)
    const preparedEntries: { loweredContent: string; content: string; timestamp: number }[] = []

    for (const entry of entries) {
      const loweredContent = entry.toLowerCase().trim()
      preparedEntries.push({ loweredContent, content: entry.trim(), timestamp })
    }

    this.databaseManager.enqueueTransaction(`saving autocomplete ${table}`, async (database) => {
      for (const entry of preparedEntries) {
        await database.query(
          `INSERT INTO "${table}" ("loweredContent", "content", "timestamp") VALUES ($1, $2, $3)
           ON CONFLICT ("loweredContent") DO UPDATE SET
             "content" = EXCLUDED."content",
             "timestamp" = EXCLUDED."timestamp"`,
          [entry.loweredContent, entry.content, entry.timestamp]
        )
      }
    })
  }

  private async fetchGuildInfo(): Promise<void> {
    const tasks = []
    const usernames: string[] = []
    const ranks: string[] = []

    for (const instance of this.application.minecraftManager.getAllInstances()) {
      if (instance.currentStatus() !== Status.Connected) continue

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

    this.addUsernames(usernames)
    this.addRanks(ranks)
  }

  private async resolveGuildRanks(): Promise<void> {
    const guildsResolver = this.application.minecraftManager
      .getMinecraftBots()
      .map((bots) => bots.uuid)
      .map((uuid) => this.application.hypixelApi.getGuild('player', uuid).catch(() => undefined))

    const guilds = await Promise.all(guildsResolver)
    const ranks: string[] = []
    for (const guild of guilds) {
      if (guild === undefined) continue

      for (const rank of guild.ranks) {
        ranks.push(rank.name)
      }
    }

    this.addRanks(ranks)
  }
}
