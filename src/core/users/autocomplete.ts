import assert from 'node:assert'

import type { Logger } from 'log4js'

import type Application from '../../application'
import { InstanceType } from '../../common/application-event'
import { Status } from '../../common/connectable-instance'
import type { DatabaseManager } from '../../common/database-manager'
import type EventHelper from '../../common/event-helper'
import SubInstance from '../../common/sub-instance'
import type UnexpectedErrorHandler from '../../common/unexpected-error-handler'
import Duration from '../../utility/duration'
import { setIntervalAsync, setTimeoutAsync } from '../../utility/scheduling'
import type { Core } from '../core'

export default class Autocomplete extends SubInstance<Core, InstanceType.Core, void> {
  private static readonly MaxLife = Duration.years(1)

  private readonly usernames = new Map<string, AutocompleteEntry>()
  private readonly ranks = new Map<string, AutocompleteEntry>()

  constructor(
    application: Application,
    clientInstance: Core,
    eventHelper: EventHelper<InstanceType.Core>,
    logger: Logger,
    errorHandler: UnexpectedErrorHandler,
    private readonly databaseManager: DatabaseManager
  ) {
    super(application, clientInstance, eventHelper, logger, errorHandler)

    application.on('chat', (event) => {
      this.addUsernames([event.user.displayName()])
    })
    application.on('guildPlayer', (event) => {
      this.addUsernames([event.user.mojangProfile().name])
    })
    application.on('command', (event) => {
      this.addUsernames([event.user.displayName()])
    })
    application.on('commandFeedback', (event) => {
      this.addUsernames([event.user.displayName()])
    })

    setIntervalAsync(async () => this.fetchGuildInfo(), {
      delay: Duration.seconds(60),
      errorHandler: this.errorHandler.promiseCatch('fetching guild info for autocomplete')
    })

    const ranksResolver = setTimeoutAsync(async () => this.resolveGuildRanks(), {
      delay: Duration.seconds(10),
      errorHandler: this.errorHandler.promiseCatch('resolving guild ranks')
    })
    application.on('minecraftSelfBroadcast', (): void => {
      ranksResolver.refresh()
    })
    application.on('instanceAnnouncement', (event): void => {
      if (event.instanceType === InstanceType.Minecraft) {
        ranksResolver.refresh()
      }
    })

    this.databaseManager.registerCleaner(() => {
      const oldestTimestamp = Math.floor((Date.now() - Autocomplete.MaxLife.toMilliseconds()) / 1000)
      const usernamesDeleted = removeOldAutocompleteEntries(this.usernames, oldestTimestamp)
      const ranksDeleted = removeOldAutocompleteEntries(this.ranks, oldestTimestamp)
      const count = usernamesDeleted + ranksDeleted

      if (count > 0) {
        this.logger.debug(`Deleted ${count} old autocomplete entry`)
        this.databaseManager.enqueueTransaction('cleaning autocomplete entries', async (database) => {
          await database.query('DELETE FROM "autocompleteUsernames" WHERE "timestamp" < $1', [oldestTimestamp])
          await database.query('DELETE FROM "autocompleteRanks" WHERE "timestamp" < $1', [oldestTimestamp])
        })
      }
    })
  }

  public async load(): Promise<void> {
    const [usernames, ranks] = await Promise.all([
      this.databaseManager.queryRows<AutocompleteEntry>('SELECT * FROM "autocompleteUsernames"'),
      this.databaseManager.queryRows<AutocompleteEntry>('SELECT * FROM "autocompleteRanks"')
    ])

    replaceAutocompleteEntries(this.usernames, usernames)
    replaceAutocompleteEntries(this.ranks, ranks)
  }

  public username(query: string, limit: number): string[] {
    return this.fetch(this.usernames, query, limit)
  }

  public rank(query: string, limit: number): string[] {
    return this.fetch(this.ranks, query, limit)
  }

  private fetch(entries: Map<string, AutocompleteEntry>, query: string, limit: number): string[] {
    assert.ok(limit >= 1, 'limit must be 1 or greater')
    limit = Math.floor(limit)

    query = query.replaceAll(/[%_]/g, '').toLowerCase()

    const allEntries = [...entries.values()].map((entry) => entry.content)
    const result = allEntries.filter((entry) => entry.toLowerCase().startsWith(query)).slice(0, limit)
    if (result.length >= limit) {
      return result
    }

    for (const entry of allEntries) {
      if (result.includes(entry)) continue
      if (!entry.toLowerCase().includes(query)) continue

      result.push(entry)
      if (result.length >= limit) break
    }

    return result
  }

  private addUsernames(usernames: string[]): void {
    this.add('autocompleteUsernames', this.usernames, usernames)
  }

  private addRanks(ranks: string[]): void {
    this.add('autocompleteRanks', this.ranks, ranks)
  }

  private add(
    table: 'autocompleteUsernames' | 'autocompleteRanks',
    target: Map<string, AutocompleteEntry>,
    entries: string[]
  ): void {
    const timestamp = Math.floor(Date.now() / 1000)
    const preparedEntries: AutocompleteEntry[] = []

    for (const entry of entries) {
      const loweredContent = entry.toLowerCase().trim()
      const normalizedEntry = { loweredContent, content: entry.trim(), timestamp }
      target.set(loweredContent, normalizedEntry)
      preparedEntries.push(normalizedEntry)
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
    this.logger.debug('Resolving guild ranks from server')

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

interface AutocompleteEntry {
  loweredContent: string
  content: string
  timestamp: number
}

function removeOldAutocompleteEntries(entries: Map<string, AutocompleteEntry>, oldestTimestamp: number): number {
  let deleted = 0
  for (const [key, entry] of entries) {
    if (entry.timestamp < oldestTimestamp) {
      entries.delete(key)
      deleted++
    }
  }
  return deleted
}

function replaceAutocompleteEntries(target: Map<string, AutocompleteEntry>, entries: AutocompleteEntry[]): void {
  target.clear()
  for (const entry of entries) {
    target.set(entry.loweredContent, entry)
  }
}
