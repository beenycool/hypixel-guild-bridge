import type { Logger } from 'log4js'

import type { InstanceIdentifier, InstanceMessage, InstanceStatus } from '../../common/application-event'
import type { Status } from '../../common/connectable-instance'
import type { DatabaseManager } from '../../common/database-manager'
import Duration from '../../utility/duration'

export class StatusHistory {
  private static readonly MaxLife = Duration.years(5)

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly logger: Logger
  ) {
    this.databaseManager.registerCleaner(() => {
      const cutoff = Date.now() - StatusHistory.MaxLife.toMilliseconds()

      this.databaseManager.enqueueTransaction('cleaning status history', async (database) => {
        await database.query('DELETE FROM "instanceStatusHistory" WHERE "createdAt" < $1', [Math.floor(cutoff / 1000)])
        await database.query('DELETE FROM "instanceMessageHistory" WHERE "createdAt" < $1', [Math.floor(cutoff / 1000)])
      })
    })
  }

  public async load(): Promise<void> {
    // No longer loading everything into RAM to prevent OOM
  }

  public add(entry: InstanceStatus): void {
    if (entry.status !== undefined) {
      this.databaseManager.enqueueWrite(`saving status history for ${entry.instanceName}`, async (database) => {
        await database.query(
          `INSERT INTO "instanceStatusHistory" ("instanceName", "instanceType", "createdAt", "fromStatus", "toStatus")
           VALUES ($1, $2, $3, $4, $5)`,
          [
            entry.instanceName,
            entry.instanceType,
            Math.floor(entry.createdAt / 1000),
            entry.status.from,
            entry.status.to
          ]
        )
      })
    }

    if (entry.message !== undefined) {
      this.databaseManager.enqueueWrite(`saving message history for ${entry.instanceName}`, async (database) => {
        await database.query(
          `INSERT INTO "instanceMessageHistory" ("instanceName", "instanceType", "createdAt", "type", "value")
           VALUES ($1, $2, $3, $4, $5)`,
          [
            entry.instanceName,
            entry.instanceType,
            Math.floor(entry.createdAt / 1000),
            entry.message.type,
            entry.message.value ?? undefined
          ]
        )
      })
    }
  }

  public async getHistory(
    instanceName: string,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<StatusHistoryEntry[]> {
    const [statusRows, messageRows] = await Promise.all([
      this.databaseManager.queryRows<StoredStatusHistoryChange>(
        'SELECT * FROM "instanceStatusHistory" WHERE "instanceName" = $1 AND "createdAt" >= $2 AND "createdAt" <= $3',
        [instanceName, Math.floor(fromTimestamp / 1000), Math.floor(toTimestamp / 1000)]
      ),
      this.databaseManager.queryRows<StoredStatusHistoryMessage>(
        'SELECT * FROM "instanceMessageHistory" WHERE "instanceName" = $1 AND "createdAt" >= $2 AND "createdAt" <= $3',
        [instanceName, Math.floor(fromTimestamp / 1000), Math.floor(toTimestamp / 1000)]
      )
    ])

    const entries: StatusHistoryEntry[] = [
      ...statusRows.map((entry) => ({
        id: entry.id,
        instanceName: entry.instanceName,
        instanceType: entry.instanceType,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        createdAt: entry.createdAt * 1000,
        entryType: StatusHistoryEntryType.Status as const
      })),
      ...messageRows.map((entry) => ({
        id: entry.id,
        instanceName: entry.instanceName,
        instanceType: entry.instanceType,
        type: entry.type,
        value: entry.value ?? undefined,
        createdAt: entry.createdAt * 1000,
        entryType: StatusHistoryEntryType.Message as const
      }))
    ]

    return entries.toSorted((a, b) => {
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
