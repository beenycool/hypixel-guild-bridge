import type { SqliteManager } from '../../common/sqlite-manager'

export class DiscordEmojis {
  private readonly entries = new Map<string, EmojiConfig>()

  constructor(private readonly sqliteManager: SqliteManager) {}

  public async load(): Promise<void> {
    const rows = await this.sqliteManager.queryRows<EmojiConfig>('SELECT "name", "hash" FROM "discordEmojis"')
    this.entries.clear()
    for (const row of rows) {
      this.entries.set(row.name.toLowerCase(), row)
    }
  }

  public replaceAll(entries: EmojiConfig[]): void {
    const nextEntries = new Map<string, EmojiConfig>()
    for (const entry of entries) {
      nextEntries.set(entry.name.toLowerCase(), entry)
    }
    this.entries.clear()
    for (const [key, value] of nextEntries) {
      this.entries.set(key, value)
    }

    this.sqliteManager.enqueueTransaction('replacing discord emojis', async (database) => {
      await database.query('DELETE FROM "discordEmojis"')
      for (const entry of entries) {
        await database.query('INSERT INTO "discordEmojis" ("name", "hash") VALUES ($1, $2)', [entry.name, entry.hash])
      }
    })
  }

  public getAll(): EmojiConfig[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }))
  }
}

export interface EmojiConfig {
  name: string
  hash: string
}
