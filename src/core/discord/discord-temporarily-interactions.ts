import type { DatabaseManager } from '../../common/database-manager'

import type { BridgeConfigurations } from './bridge-configurations'
import type { DiscordConfigurations } from './discord-configurations'

export class DiscordTemporarilyInteractions {
  private readonly entries = new Map<string, DiscordMessage>()

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly discordConfigurations: DiscordConfigurations,
    private readonly bridgeConfigurations: BridgeConfigurations
  ) {}

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<StoredDiscordMessage>(
      'SELECT "messageId", "channelId", "createdAt", "type", "bridgeId" FROM "discordTempInteractions"'
    )
    this.entries.clear()
    for (const row of rows) {
      this.entries.set(row.messageId, { ...row, createdAt: row.createdAt * 1000 })
    }
  }

  public add(entries: DiscordMessage[]): void {
    for (const entry of entries) {
      this.entries.set(entry.messageId, entry)
    }

    this.databaseManager.enqueueTransaction('saving temporary discord interactions', async (database) => {
      for (const entry of entries) {
        await database.query(
          `INSERT INTO "discordTempInteractions" ("messageId", "channelId", "createdAt", "type", "bridgeId") VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("messageId") DO UPDATE SET
             "channelId" = EXCLUDED."channelId",
             "createdAt" = EXCLUDED."createdAt",
             "type" = EXCLUDED."type",
             "bridgeId" = EXCLUDED."bridgeId"`,
          [
            entry.messageId,
            entry.channelId,
            Math.floor(entry.createdAt / 1000),
            entry.type ?? 'online-offline',
            entry.bridgeId ?? null
          ]
        )
      }
    })
  }

  public findToDelete(): DiscordMessage[] {
    const currentTime = Date.now()
    const maxInteractions = this.discordConfigurations.getMaxTemporarilyInteractions()
    const onlineOfflineDuration = this.discordConfigurations.getDurationTemporarilyInteractions()
    const joinLeaveDuration = this.discordConfigurations.getDurationJoinLeaveInteractions()

    const allInteractions = [...this.entries.values()]
      .map((entry) => ({ ...entry }))
      .toReversed()
      .toSorted((a, b) => b.createdAt - a.createdAt)
    const toDelete: DiscordMessage[] = []

    const interactionsCount = new Map<string, number>()
    for (const interaction of allInteractions) {
      if (interaction.type === 'join-leave') {
        const duration = interaction.bridgeId
          ? this.bridgeConfigurations.getDurationJoinLeaveInteractions(interaction.bridgeId)
          : joinLeaveDuration
        if (interaction.createdAt + duration.toMilliseconds() < currentTime) {
          toDelete.push(interaction)
        }
        continue
      }

      const duration = interaction.bridgeId
        ? this.bridgeConfigurations.getDurationTemporarilyInteractions(interaction.bridgeId)
        : onlineOfflineDuration
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

    this.databaseManager.enqueueTransaction('removing temporary discord interactions', async (database) => {
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
  type?: string
  bridgeId?: string
}

interface StoredDiscordMessage extends Omit<DiscordMessage, 'createdAt'> {
  createdAt: number
}
