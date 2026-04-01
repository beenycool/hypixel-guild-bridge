import type { SqliteManager } from '../../common/sqlite-manager'

export interface InactivityEntry {
  uuid: string
  discordId: string
  reason: string
  createdAt: number
  expiresAt: number
}

export class Inactivity {
  private readonly entries = new Map<string, InactivityEntry>()

  constructor(private readonly sqliteManager: SqliteManager) {}

  public async load(): Promise<void> {
    const rows = await this.sqliteManager.queryRows<InactivityEntry>('SELECT * FROM "inactivity"')
    this.entries.clear()
    for (const row of rows) {
      this.entries.set(row.uuid, row)
    }
  }

  public getActiveByUuid(uuid: string): InactivityEntry | undefined {
    const entry = this.entries.get(uuid)
    if (entry === undefined || entry.expiresAt <= nowSeconds()) return undefined
    return entry
  }

  public getActiveByDiscordId(discordId: string): InactivityEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.discordId === discordId && entry.expiresAt > nowSeconds()) {
        return entry
      }
    }
  }

  public getAllActive(): InactivityEntry[] {
    const now = nowSeconds()
    return [...this.entries.values()].filter((entry) => entry.expiresAt > now)
  }

  public add(entry: Omit<InactivityEntry, 'createdAt'>): void {
    const completeEntry = { ...entry, createdAt: nowSeconds() }
    this.entries.set(completeEntry.uuid, completeEntry)

    this.sqliteManager.enqueueWrite(`saving inactivity ${completeEntry.uuid}`, async (database) => {
      await database.query(
        `INSERT INTO "inactivity" ("uuid", "discordId", "reason", "createdAt", "expiresAt") VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("uuid") DO UPDATE SET
           "discordId" = EXCLUDED."discordId",
           "reason" = EXCLUDED."reason",
           "createdAt" = EXCLUDED."createdAt",
           "expiresAt" = EXCLUDED."expiresAt"`,
        [
          completeEntry.uuid,
          completeEntry.discordId,
          completeEntry.reason,
          completeEntry.createdAt,
          completeEntry.expiresAt
        ]
      )
    })
  }

  public removeByUuid(uuid: string): number {
    const existed = this.entries.delete(uuid) ? 1 : 0

    this.sqliteManager.enqueueWrite(`deleting inactivity ${uuid}`, async (database) => {
      await database.query('DELETE FROM "inactivity" WHERE "uuid" = $1', [uuid])
    })

    return existed
  }

  public purgeExpired(): number {
    const now = nowSeconds()
    const expiredUuids = [...this.entries.values()].filter((entry) => entry.expiresAt <= now).map((entry) => entry.uuid)

    for (const uuid of expiredUuids) {
      this.entries.delete(uuid)
    }

    if (expiredUuids.length > 0) {
      this.sqliteManager.enqueueWrite('purging expired inactivity entries', async (database) => {
        await database.query('DELETE FROM "inactivity" WHERE "expiresAt" <= $1', [now])
      })
    }

    return expiredUuids.length
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
