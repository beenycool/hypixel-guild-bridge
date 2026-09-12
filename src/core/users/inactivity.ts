import type { DatabaseManager } from '../../common/database-manager'

export interface InactivityEntry {
  bridgeId: string
  uuid: string
  discordId: string
  createdBy: string
  reason: string
  createdAt: number
  expiresAt: number
}

export class Inactivity {
  private readonly entries = new Map<string, InactivityEntry>()

  constructor(private readonly databaseManager: DatabaseManager) {
    this.databaseManager.registerCleaner(() => {
      this.purgeExpired()
    })
  }

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<InactivityEntry>('SELECT * FROM "inactivity"')

    this.entries.clear()
    for (const row of rows) {
      this.entries.set(`${row.bridgeId}:${row.uuid}`, row)
    }
  }

  public getActive(bridgeId: string, uuid: string): InactivityEntry | undefined {
    const entry = this.entries.get(`${bridgeId}:${uuid}`)
    if (entry === undefined || entry.expiresAt <= nowSeconds()) return undefined
    return entry
  }

  public getAllActive(bridgeId: string): InactivityEntry[] {
    const now = nowSeconds()
    return [...this.entries.values()].filter((entry) => entry.expiresAt > now && entry.bridgeId === bridgeId)
  }

  public getActiveByDiscordId(bridgeId: string, discordId: string): InactivityEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.bridgeId === bridgeId && entry.discordId === discordId && entry.expiresAt > nowSeconds()) {
        return entry
      }
    }
    return undefined
  }

  public add(entry: Omit<InactivityEntry, 'createdAt'>): void {
    const completeEntry = { ...entry, createdAt: nowSeconds() }
    this.entries.set(`${completeEntry.bridgeId}:${completeEntry.uuid}`, completeEntry)

    this.databaseManager.enqueueWrite(
      `saving inactivity ${completeEntry.bridgeId}:${completeEntry.uuid}`,
      async (database) => {
        await database.query(
          `INSERT INTO "inactivity" ("bridgeId", "uuid", "discordId", "createdBy", "reason", "createdAt", "expiresAt") VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("bridgeId", "uuid") DO UPDATE SET
           "discordId" = EXCLUDED."discordId",
           "createdBy" = EXCLUDED."createdBy",
           "reason" = EXCLUDED."reason",
           "createdAt" = EXCLUDED."createdAt",
           "expiresAt" = EXCLUDED."expiresAt"`,
          [
            completeEntry.bridgeId,
            completeEntry.uuid,
            completeEntry.discordId,
            completeEntry.createdBy,
            completeEntry.reason,
            completeEntry.createdAt,
            completeEntry.expiresAt
          ]
        )
      }
    )
  }

  public remove(bridgeId: string, uuid: string): number {
    const existed = this.entries.delete(`${bridgeId}:${uuid}`) ? 1 : 0

    this.databaseManager.enqueueWrite(`deleting inactivity ${bridgeId}:${uuid}`, async (database) => {
      await database.query('DELETE FROM "inactivity" WHERE "bridgeId" = $1 AND "uuid" = $2', [bridgeId, uuid])
    })

    return existed
  }

  public purgeExpired(): number {
    const now = nowSeconds()
    const expiredKeys = [...this.entries.values()]
      .filter((entry) => entry.expiresAt <= now)
      .map((entry) => `${entry.bridgeId}:${entry.uuid}`)

    for (const key of expiredKeys) {
      this.entries.delete(key)
    }

    if (expiredKeys.length > 0) {
      this.databaseManager.enqueueWrite('purging expired inactivity entries', async (database) => {
        await database.query('DELETE FROM "inactivity" WHERE "expiresAt" <= $1', [now])
      })
    }

    return expiredKeys.length
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
