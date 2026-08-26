import type { InstanceIdentifier } from '../../common/application-event'
import type { DatabaseManager } from '../../common/database-manager'
import Duration from '../../utility/duration'

export class InstanceHistoryButton {
  private static readonly MaxLife = Duration.years(2)

  private readonly buttons = new Map<string, DiscordPersistentInstance>()
  private readonly lastButtons = new Map<string, string>()

  constructor(private readonly databaseManager: DatabaseManager) {
    this.databaseManager.registerCleaner(() => {
      const cutoff = Date.now() - InstanceHistoryButton.MaxLife.toMilliseconds()
      let deleted = 0

      for (const [messageId, button] of this.buttons) {
        if (button.endTime < cutoff) {
          this.buttons.delete(messageId)
          this.lastButtons.delete(lastButtonKey(button.channelId, button.instanceName))
          deleted++
        }
      }

      if (deleted > 0) {
        this.databaseManager.enqueueWrite('cleaning old discord history buttons', async (database) => {
          await database.query('DELETE FROM "discordInstanceHistoryButton" WHERE "createdAt" < $1', [
            Math.floor(cutoff / 1000)
          ])
          await database.query('DELETE FROM "discordInstanceHistoryLastButton" WHERE "createdAt" < $1', [
            Math.floor(cutoff / 1000)
          ])
        })
      }
    })
  }

  public async load(): Promise<void> {
    const buttons = await this.databaseManager.queryRows<StoredDiscordPersistentInstance>(
      'SELECT * FROM "discordInstanceHistoryButton"'
    )
    const lastButtons = await this.databaseManager.queryRows<StoredLastButton>(
      'SELECT * FROM "discordInstanceHistoryLastButton"'
    )

    this.buttons.clear()
    for (const button of buttons) {
      this.buttons.set(button.messageId, {
        ...button,
        startTime: button.startTime * 1000,
        endTime: button.endTime * 1000
      })
    }

    this.lastButtons.clear()
    for (const button of lastButtons) {
      this.lastButtons.set(lastButtonKey(button.channelId, button.instanceName), button.messageId)
    }
  }

  public add(entry: DiscordPersistentInstance): void {
    this.buttons.set(entry.messageId, { ...entry })
    this.lastButtons.set(lastButtonKey(entry.channelId, entry.instanceName), entry.messageId)

    this.databaseManager.enqueueTransaction(`saving discord history button ${entry.messageId}`, async (database) => {
      await database.query(
        `INSERT INTO "discordInstanceHistoryButton"
          ("messageId", "channelId", "instanceName", "instanceType", "type", "startTime", "endTime", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ("messageId") DO UPDATE SET
           "channelId" = EXCLUDED."channelId",
           "instanceName" = EXCLUDED."instanceName",
           "instanceType" = EXCLUDED."instanceType",
           "type" = EXCLUDED."type",
           "startTime" = EXCLUDED."startTime",
           "endTime" = EXCLUDED."endTime",
           "createdAt" = EXCLUDED."createdAt"`,
        [
          entry.messageId,
          entry.channelId,
          entry.instanceName,
          entry.instanceType,
          entry.type,
          Math.floor(entry.startTime / 1000),
          Math.floor(entry.endTime / 1000),
          Math.floor(entry.endTime / 1000)
        ]
      )
      await database.query(
        `INSERT INTO "discordInstanceHistoryLastButton" ("messageId", "channelId", "instanceName", "createdAt") VALUES ($1, $2, $3, $4)
         ON CONFLICT ("channelId", "instanceName") DO UPDATE SET
           "messageId" = EXCLUDED."messageId",
           "createdAt" = EXCLUDED."createdAt"`,
        [entry.messageId, entry.channelId, entry.instanceName, Math.floor(entry.endTime / 1000)]
      )
    })
  }

  public getButton(messageId: string): DiscordPersistentInstance | undefined {
    const entry = this.buttons.get(messageId)
    return entry === undefined ? undefined : { ...entry }
  }

  public lastButton(channelId: string, instanceName: string): DiscordPersistentInstance | undefined {
    const lastMessageId = this.lastButtons.get(lastButtonKey(channelId, instanceName))
    if (!lastMessageId) return undefined

    const entry = this.buttons.get(lastMessageId)
    return entry === undefined ? undefined : { ...entry }
  }

  public extendButtonEndTimestamp(messageId: string, endTimestamp: number): void {
    const entry = this.buttons.get(messageId)
    if (entry === undefined) return

    entry.endTime = endTimestamp
    this.databaseManager.enqueueWrite(`extending discord history button ${messageId}`, async (database) => {
      await database.query('UPDATE "discordInstanceHistoryButton" SET "endTime" = $1 WHERE "messageId" = $2', [
        Math.floor(endTimestamp / 1000),
        messageId
      ])
    })
  }

  public remove(messagesIds: string[]): number {
    let count = 0
    for (const messageId of messagesIds) {
      const entry = this.buttons.get(messageId)
      if (entry !== undefined) {
        this.lastButtons.delete(lastButtonKey(entry.channelId, entry.instanceName))
      }
      if (this.buttons.delete(messageId)) count++
    }

    this.databaseManager.enqueueTransaction('removing discord history buttons', async (database) => {
      for (const messageId of messagesIds) {
        await database.query('DELETE FROM "discordInstanceHistoryButton" WHERE "messageId" = $1', [messageId])
        await database.query('DELETE FROM "discordInstanceHistoryLastButton" WHERE "messageId" = $1', [messageId])
      }
    })

    return count
  }
}

export interface DiscordPersistentInstance extends InstanceIdentifier {
  messageId: string
  channelId: string

  type: DiscordInstanceHistoryButtonType

  startTime: number
  endTime: number
}

enum DiscordInstanceHistoryButtonType {
  Failed = 'failed',
  Success = 'success',
  Notice = 'notice'
}

interface StoredDiscordPersistentInstance extends Omit<DiscordPersistentInstance, 'startTime' | 'endTime'> {
  startTime: number
  endTime: number
}

interface StoredLastButton {
  messageId: string
  channelId: string
  instanceName: string
}

function lastButtonKey(channelId: string, instanceName: string): string {
  return `${channelId}:${instanceName.toLowerCase()}`
}
