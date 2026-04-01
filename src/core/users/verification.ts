import type { UserLink } from '../../common/application-event'
import type { SqliteManager } from '../../common/sqlite-manager'

export class Verification {
  private readonly linksByUuid = new Map<string, UserLink>()
  private readonly linksByDiscordId = new Map<string, UserLink>()

  constructor(private readonly sqliteManager: SqliteManager) {}

  public async load(): Promise<void> {
    const links = await this.sqliteManager.queryRows<UserLink>('SELECT "uuid", "discordId" FROM "links"')

    this.linksByUuid.clear()
    this.linksByDiscordId.clear()
    for (const link of links) {
      this.linksByUuid.set(link.uuid, link)
      this.linksByDiscordId.set(link.discordId, link)
    }
  }

  public findByDiscord(discordId: string): Awaitable<UserLink | undefined> {
    return this.linksByDiscordId.get(discordId)
  }

  public findByIngame(uuid: string): Awaitable<UserLink | undefined> {
    return this.linksByUuid.get(uuid)
  }

  public addConfirmedLink(discordId: string, uuid: string): void {
    const existingByUuid = this.linksByUuid.get(uuid)
    if (existingByUuid !== undefined) {
      this.linksByUuid.delete(existingByUuid.uuid)
      this.linksByDiscordId.delete(existingByUuid.discordId)
    }

    const existingByDiscord = this.linksByDiscordId.get(discordId)
    if (existingByDiscord !== undefined) {
      this.linksByUuid.delete(existingByDiscord.uuid)
      this.linksByDiscordId.delete(existingByDiscord.discordId)
    }

    const link = { uuid, discordId }
    this.linksByUuid.set(uuid, link)
    this.linksByDiscordId.set(discordId, link)

    this.sqliteManager.enqueueTransaction(`saving verification link ${uuid}`, async (database) => {
      await database.query('DELETE FROM "links" WHERE "uuid" = $1 OR "discordId" = $2', [uuid, discordId])
      await database.query('INSERT INTO "links" ("uuid", "discordId") VALUES ($1, $2)', [uuid, discordId])
    })
  }

  public getAllLinks(): UserLink[] {
    return [...this.linksByUuid.values()]
  }

  public invalidate(options: { discordId?: string; uuid?: string }): number {
    let count = 0

    if (options.uuid !== undefined) {
      const link = this.linksByUuid.get(options.uuid)
      if (link !== undefined) {
        this.linksByUuid.delete(link.uuid)
        this.linksByDiscordId.delete(link.discordId)
        count++
      }

      this.sqliteManager.enqueueWrite(`invalidating verification uuid ${options.uuid}`, async (database) => {
        await database.query('DELETE FROM "links" WHERE "uuid" = $1', [options.uuid])
      })
    }

    if (options.discordId !== undefined) {
      const link = this.linksByDiscordId.get(options.discordId)
      if (link !== undefined) {
        this.linksByUuid.delete(link.uuid)
        this.linksByDiscordId.delete(link.discordId)
        count++
      }

      this.sqliteManager.enqueueWrite(`invalidating verification discord ${options.discordId}`, async (database) => {
        await database.query('DELETE FROM "links" WHERE "discordId" = $1', [options.discordId])
      })
    }

    return count
  }
}
