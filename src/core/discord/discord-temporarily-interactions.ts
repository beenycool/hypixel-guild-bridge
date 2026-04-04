import type { SqliteManager } from '../../common/sqlite-manager'

import type { DiscordConfigurations } from './discord-configurations'

export class DiscordTemporarilyInteractions {
  private readonly entries = new Map<string, DiscordMessage>()

  constructor(
    private readonly sqliteManager: SqliteManager,
    private readonly discordConfigurations: DiscordConfigurations
  ) {}

  public async load(): Promise<void> {
    const rows = await this.sqliteManager.queryRows<StoredDiscordMessage>('SELECT * FROM "discordTempInteractions"')
    this.entries.clear()
    for (const row of rows) {
      this.entries.set(row.messageId, { ...row, createdAt: row.createdAt * 1000 })
    }
  }

  public add(entries: DiscordMessage[]): void {
    for (const entry of entries) {
      this.entries.set(entry.messageId, entry)
    }

    this.sqliteManager.enqueueTransaction('saving temporary discord interactions', async (database) => {
      for (const entry of entries) {
        await database.query(
          `INSERT INTO "discordTempInteractions" ("messageId", "channelId", "createdAt") VALUES ($1, $2, $3)
           ON CONFLICT ("messageId") DO UPDATE SET
             "channelId" = EXCLUDED."channelId",
             "createdAt" = EXCLUDED."createdAt"`,
          [entry.messageId, entry.channelId, Math.floor(entry.createdAt / 1000)]
        )
      }
    })
  }

  public findToDelete(): DiscordMessage[] {
    const currentTime = Date.now()
    const maxInteractions = this.discordConfigurations.getMaxTemporarilyInteractions()
    const duration = this.discordConfigurations.getDurationTemporarilyInteractions()

    const allInteractions = [...this.entries.values()].map((entry) => ({ ...entry }))
    const toDelete: DiscordMessage[] = []

    allInteractions.reverse().sort((a, b) => b.createdAt - a.createdAt)

    const interactionsCount = new Map<string, number>()
    for (const interaction of allInteractions) {
      if (interaction.createdAt + duration.toMilliseconds() < currentTime) {
        toDelete.push(interaction)
        continue
      }

      const currentInteractionsCount = interactionsCount.get(interaction.channelId) ?? 0
      if (currentInteractionsCount >= maxInteractions) {
        toDelete.push(interaction)
        continue
      }

      interactionsCount.set(interaction.channelId, currentInteractionsCount + 1)
    }

    return toDelete
  }

  public remove(messagesIds: DiscordMessage['messageId'][]): number {
    let count = 0
    for (const messageId of messagesIds) {
      if (this.entries.delete(messageId)) count++
    }

    this.sqliteManager.enqueueTransaction('removing temporary discord interactions', async (database) => {
      for (const messageId of messagesIds) {
        await database.query('DELETE FROM "discordTempInteractions" WHERE "messageId" = $1', [messageId])
      }
    })

    return count
  }
}

export interface DiscordMessage {
  channelId: string
  messageId: string
  createdAt: number
}

interface StoredDiscordMessage extends Omit<DiscordMessage, 'createdAt'> {
  createdAt: number
}
