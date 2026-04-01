import type { SqliteManager } from '../../common/sqlite-manager'

export class DiscordLeaderboards {
  private readonly entries = new Map<string, LeaderboardEntry>()

  constructor(private readonly sqliteManager: SqliteManager) {}

  public async load(): Promise<void> {
    const rows = await this.sqliteManager.queryRows<StoredLeaderboardEntry>('SELECT * FROM "discordLeaderboards"')
    this.entries.clear()
    for (const row of rows) {
      this.entries.set(row.messageId, fromStoredEntry(row))
    }
  }

  public getAll(): LeaderboardEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }))
  }

  public addOrSet(entry: LeaderboardEntry): void {
    const existing = this.entries.get(entry.messageId)
    const now = Date.now()
    const stored = {
      ...entry,
      createdAt: existing?.createdAt ?? entry.createdAt ?? now,
      updatedAt: existing?.updatedAt ?? entry.updatedAt ?? now,
      guildId: entry.guildId
    }
    this.entries.set(entry.messageId, stored)

    this.sqliteManager.enqueueWrite(`saving discord leaderboard ${entry.messageId}`, async (database) => {
      await database.query(
        `INSERT INTO "discordLeaderboards" ("messageId", "type", "channelId", "guildId", "updatedAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("messageId") DO UPDATE SET
           "type" = EXCLUDED."type",
           "channelId" = EXCLUDED."channelId",
           "guildId" = EXCLUDED."guildId",
           "updatedAt" = EXCLUDED."updatedAt"`,
        [
          stored.messageId,
          stored.type,
          stored.channelId,
          stored.guildId ?? null,
          Math.floor(stored.updatedAt / 1000),
          Math.floor(stored.createdAt / 1000)
        ]
      )
    })
  }

  public updateTime(entries: { messageId: string; updatedAt: number }[]): void {
    for (const entry of entries) {
      const current = this.entries.get(entry.messageId)
      if (current !== undefined) {
        current.updatedAt = entry.updatedAt
      }
    }

    this.sqliteManager.enqueueTransaction('updating discord leaderboard timestamps', async (database) => {
      for (const entry of entries) {
        await database.query('UPDATE "discordLeaderboards" SET "updatedAt" = $1 WHERE "messageId" = $2', [
          Math.floor(entry.updatedAt / 1000),
          entry.messageId
        ])
      }
    })
  }

  public remove(messagesIds: string[]): number {
    let count = 0
    for (const messageId of messagesIds) {
      if (this.entries.delete(messageId)) count++
    }

    this.sqliteManager.enqueueTransaction('removing discord leaderboards', async (database) => {
      for (const messageId of messagesIds) {
        await database.query('DELETE FROM "discordLeaderboards" WHERE "messageId" = $1', [messageId])
      }
    })

    return count
  }
}

export interface LeaderboardEntry {
  messageId: string
  type: 'messages30Days' | 'online30Days' | 'points30Days'

  channelId: string
  guildId: string | undefined

  updatedAt: number
  createdAt: number
}

interface StoredLeaderboardEntry extends Omit<LeaderboardEntry, 'guildId' | 'updatedAt' | 'createdAt'> {
  guildId: string | null
  updatedAt: number
  createdAt: number
}

function fromStoredEntry(entry: StoredLeaderboardEntry): LeaderboardEntry {
  return {
    ...entry,
    guildId: entry.guildId ?? undefined,
    updatedAt: entry.updatedAt * 1000,
    createdAt: entry.createdAt * 1000
  }
}
