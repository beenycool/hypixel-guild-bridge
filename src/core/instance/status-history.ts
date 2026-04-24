import type { Logger } from 'log4js'

import type { InstanceIdentifier, InstanceMessage, InstanceStatus } from '../../common/application-event'
import type { Status } from '../../common/connectable-instance'
import type { DatabaseManager } from '../../common/database-manager'
import Duration from '../../utility/duration'

export class StatusHistory {
  private static readonly MaxLife = Duration.years(5)

  private readonly statusEntries: StatusHistoryChange[] = []
  private readonly messageEntries: StatusHistoryMessage[] = []
  private nextStatusId = 1
  private nextMessageId = 1

  constructor(
    private readonly databaseManager: DatabaseManager,
    logger: Logger
  ) {
    this.databaseManager.registerCleaner(() => {
      const cutoff = Date.now() - StatusHistory.MaxLife.toMilliseconds()
      const statusDeleted = removeExpiredEntries(this.statusEntries, cutoff)
      const messageDeleted = removeExpiredEntries(this.messageEntries, cutoff)

      if (statusDeleted > 0) {
        logger.debug(`Deleted ${statusDeleted} old entries in instanceStatusHistory.`)
      }
      if (messageDeleted > 0) {
        logger.debug(`Deleted ${messageDeleted} old entries in instanceMessageHistory.`)
      }

      if (statusDeleted + messageDeleted > 0) {
        this.databaseManager.enqueueTransaction('cleaning status history', async (database) => {
          await database.query('DELETE FROM "instanceStatusHistory" WHERE "createdAt" < $1', [
            Math.floor(cutoff / 1000)
          ])
          await database.query('DELETE FROM "instanceMessageHistory" WHERE "createdAt" < $1', [
            Math.floor(cutoff / 1000)
          ])
        })
      }
    })
  }

  public async load(): Promise<void> {
    const statusEntries = await this.databaseManager.queryRows<StoredStatusHistoryChange>(
      'SELECT * FROM "instanceStatusHistory" ORDER BY "id" ASC'
    )
    const messageEntries = await this.databaseManager.queryRows<StoredStatusHistoryMessage>(
      'SELECT * FROM "instanceMessageHistory" ORDER BY "id" ASC'
    )

    this.statusEntries.length = 0
    this.statusEntries.push(
      ...statusEntries.map((entry) => ({
        id: entry.id,
        instanceName: entry.instanceName,
        instanceType: entry.instanceType,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        createdAt: entry.createdAt * 1000,
        entryType: StatusHistoryEntryType.Status as const
      }))
    )
    let maxStatusId = 0
    for (const entry of statusEntries) {
      if (entry.id > maxStatusId) maxStatusId = entry.id
    }
    this.nextStatusId = maxStatusId + 1

    this.messageEntries.length = 0
    this.messageEntries.push(
      ...messageEntries.map((entry) => ({
        id: entry.id,
        instanceName: entry.instanceName,
        instanceType: entry.instanceType,
        type: entry.type,
        value: entry.value ?? undefined,
        createdAt: entry.createdAt * 1000,
        entryType: StatusHistoryEntryType.Message as const
      }))
    )
    let maxMessageId = 0
    for (const entry of messageEntries) {
      if (entry.id > maxMessageId) maxMessageId = entry.id
    }
    this.nextMessageId = maxMessageId + 1
  }

  public add(entry: InstanceStatus): void {
    if (entry.status !== undefined) {
      const statusEntry: StatusHistoryChange = {
        id: this.nextStatusId++,
        instanceName: entry.instanceName,
        instanceType: entry.instanceType,
        fromStatus: entry.status.from,
        toStatus: entry.status.to,
        createdAt: entry.createdAt,
        entryType: StatusHistoryEntryType.Status
      }
      this.statusEntries.push(statusEntry)

      this.databaseManager.enqueueWrite(`saving status history for ${entry.instanceName}`, async (database) => {
        await database.query(
          `INSERT INTO "instanceStatusHistory" ("id", "instanceName", "instanceType", "createdAt", "fromStatus", "toStatus")
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            statusEntry.id,
            statusEntry.instanceName,
            statusEntry.instanceType,
            Math.floor(statusEntry.createdAt / 1000),
            statusEntry.fromStatus,
            statusEntry.toStatus
          ]
        )
      })
    }

    if (entry.message !== undefined) {
      const messageEntry: StatusHistoryMessage = {
        id: this.nextMessageId++,
        instanceName: entry.instanceName,
        instanceType: entry.instanceType,
        type: entry.message.type,
        value: entry.message.value ?? undefined,
        createdAt: entry.createdAt,
        entryType: StatusHistoryEntryType.Message
      }
      this.messageEntries.push(messageEntry)

      this.databaseManager.enqueueWrite(`saving message history for ${entry.instanceName}`, async (database) => {
        await database.query(
          `INSERT INTO "instanceMessageHistory" ("id", "instanceName", "instanceType", "createdAt", "type", "value")
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            messageEntry.id,
            messageEntry.instanceName,
            messageEntry.instanceType,
            Math.floor(messageEntry.createdAt / 1000),
            messageEntry.type,
            messageEntry.value ?? undefined
          ]
        )
      })
    }
  }

  public getHistory(instanceName: string, fromTimestamp: number, toTimestamp: number): StatusHistoryEntry[] {
    const entries: StatusHistoryEntry[] = [
      ...this.statusEntries.filter(
        (entry) =>
          entry.instanceName === instanceName && entry.createdAt >= fromTimestamp && entry.createdAt <= toTimestamp
      ),
      ...this.messageEntries.filter(
        (entry) =>
          entry.instanceName === instanceName && entry.createdAt >= fromTimestamp && entry.createdAt <= toTimestamp
      )
    ]

    return entries
      .map((entry) => ({ ...entry }))
      .toSorted((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt
        }
        if (a.entryType === b.entryType) {
          return 0
        }
        return a.entryType === StatusHistoryEntryType.Status ? -1 : 1
      })
  }
}

export type StatusHistoryEntry = StatusHistoryMessage | StatusHistoryChange

export type StatusHistoryMessage = InstanceMessage & {
  entryType: StatusHistoryEntryType.Message
  id: number
} & InstanceIdentifier & { createdAt: number }

export type StatusHistoryChange = { fromStatus: Status; toStatus: Status } & {
  entryType: StatusHistoryEntryType.Status
  id: number
} & InstanceIdentifier & { createdAt: number }

export enum StatusHistoryEntryType {
  Message = 'message',
  Status = 'status'
}

interface StoredStatusHistoryChange {
  id: number
  instanceName: string
  instanceType: InstanceIdentifier['instanceType']
  fromStatus: Status
  toStatus: Status
  createdAt: number
}

interface StoredStatusHistoryMessage {
  id: number
  instanceName: string
  instanceType: InstanceIdentifier['instanceType']
  type: InstanceMessage['type']
  value: string | null
  createdAt: number
}

function removeExpiredEntries(entries: { createdAt: number }[], cutoff: number): number {
  let deleted = 0
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].createdAt < cutoff) {
      entries.splice(index, 1)
      deleted++
    }
  }
  return deleted
}
