import type { UserLink } from '../../common/application-event'
import type { DatabaseManager } from '../../common/database-manager'

export class Verification {
  private readonly linksByUuid = new Map<string, UserLink>()
  private readonly linksByDiscordId = new Map<string, UserLink>()

  constructor(private readonly databaseManager: DatabaseManager) {}

  public async load(): Promise<void> {
    const links = await this.databaseManager.queryRows<{
      bridgeId: string | null
      uuid: string
      discordId: string
    }>('SELECT "bridgeId", "uuid", "discordId" FROM "links"')

    this.linksByUuid.clear()
    this.linksByDiscordId.clear()
    for (const link of links) {
      if (link.bridgeId === null || link.bridgeId.length === 0) continue

      this.linksByUuid.set(Verification.uuidKey(link.bridgeId, link.uuid), {
        bridgeId: link.bridgeId,
        uuid: link.uuid,
        discordId: link.discordId
      })
      this.linksByDiscordId.set(Verification.discordKey(link.bridgeId, link.discordId), {
        bridgeId: link.bridgeId,
        uuid: link.uuid,
        discordId: link.discordId
      })
    }
  }

  public findByDiscord(discordId: string, bridgeId: string): Awaitable<UserLink | undefined> {
    return this.linksByDiscordId.get(Verification.discordKey(bridgeId, discordId))
  }

  public findByIngame(uuid: string, bridgeId: string): Awaitable<UserLink | undefined> {
    return this.linksByUuid.get(Verification.uuidKey(bridgeId, uuid))
  }

  public addConfirmedLink(discordId: string, uuid: string, bridgeId: string): void {
    const existingByUuid = this.linksByUuid.get(Verification.uuidKey(bridgeId, uuid))
    if (existingByUuid !== undefined) {
      this.linksByUuid.delete(Verification.uuidKey(bridgeId, existingByUuid.uuid))
      this.linksByDiscordId.delete(Verification.discordKey(bridgeId, existingByUuid.discordId))
    }

    const existingByDiscord = this.linksByDiscordId.get(Verification.discordKey(bridgeId, discordId))
    if (existingByDiscord !== undefined) {
      this.linksByUuid.delete(Verification.uuidKey(bridgeId, existingByDiscord.uuid))
      this.linksByDiscordId.delete(Verification.discordKey(bridgeId, existingByDiscord.discordId))
    }

    const link = { bridgeId, uuid, discordId }
    this.linksByUuid.set(Verification.uuidKey(bridgeId, uuid), link)
    this.linksByDiscordId.set(Verification.discordKey(bridgeId, discordId), link)

    this.databaseManager.enqueueTransaction(`saving verification link ${uuid}`, async (database) => {
      await database.query('DELETE FROM "links" WHERE "bridgeId" = $1 AND ("uuid" = $2 OR "discordId" = $3)', [
        bridgeId,
        uuid,
        discordId
      ])
      await database.query('INSERT INTO "links" ("bridgeId", "uuid", "discordId") VALUES ($1, $2, $3)', [
        bridgeId,
        uuid,
        discordId
      ])
    })
  }

  public getAllLinks(bridgeId?: string): UserLink[] {
    const links = [...this.linksByUuid.values()]
    if (bridgeId === undefined) return links

    return links.filter((link) => link.bridgeId === bridgeId)
  }

  public invalidate(options: { discordId?: string; uuid?: string; bridgeId?: string }): number {
    let count = 0
    const bridgeId = options.bridgeId

    if (options.uuid !== undefined) {
      const uuid = options.uuid
      const targets =
        bridgeId === undefined
          ? [...this.linksByUuid.values()].filter((link) => link.uuid === uuid)
          : [this.linksByUuid.get(Verification.uuidKey(bridgeId, uuid))].filter(
              (link): link is UserLink => link !== undefined
            )

      for (const link of targets) {
        this.linksByUuid.delete(Verification.uuidKey(link.bridgeId, link.uuid))
        this.linksByDiscordId.delete(Verification.discordKey(link.bridgeId, link.discordId))
        count++
      }

      this.databaseManager.enqueueWrite(`invalidating verification uuid ${uuid}`, async (database) => {
        const query =
          bridgeId === undefined
            ? 'DELETE FROM "links" WHERE "uuid" = $1'
            : 'DELETE FROM "links" WHERE "uuid" = $1 AND "bridgeId" = $2'
        const values = bridgeId === undefined ? [uuid] : [uuid, bridgeId]
        await database.query(query, values)
      })
    }

    if (options.discordId !== undefined) {
      const discordId = options.discordId
      const targets =
        bridgeId === undefined
          ? [...this.linksByDiscordId.values()].filter((link) => link.discordId === discordId)
          : [this.linksByDiscordId.get(Verification.discordKey(bridgeId, discordId))].filter(
              (link): link is UserLink => link !== undefined
            )

      for (const link of targets) {
        this.linksByUuid.delete(Verification.uuidKey(link.bridgeId, link.uuid))
        this.linksByDiscordId.delete(Verification.discordKey(link.bridgeId, link.discordId))
        count++
      }

      this.databaseManager.enqueueWrite(`invalidating verification discord ${discordId}`, async (database) => {
        const query =
          bridgeId === undefined
            ? 'DELETE FROM "links" WHERE "discordId" = $1'
            : 'DELETE FROM "links" WHERE "discordId" = $1 AND "bridgeId" = $2'
        const values = bridgeId === undefined ? [discordId] : [discordId, bridgeId]
        await database.query(query, values)
      })
    }

    return count
  }

  private static uuidKey(bridgeId: string, uuid: string): string {
    return `${bridgeId}:${uuid}`
  }

  private static discordKey(bridgeId: string, discordId: string): string {
    return `${bridgeId}:${discordId}`
  }
}
