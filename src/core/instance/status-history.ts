import type { Logger } from 'log4js'

import type { InstanceIdentifier, InstanceStatus } from '../../common/application-event'
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
      })
    })
  }

  public load(): Promise<void> {
    return Promise.resolve()
  }

  public add(entry: InstanceStatus): void {
    this.databaseManager.enqueueWrite(`saving status history for ${entry.instanceName}`, async (database) => {
      await database.query(
        `INSERT INTO "instanceStatusHistory" ("instanceName", "instanceType", "createdAt", "fromStatus", "toStatus")
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.instanceName, entry.instanceType, Math.floor(entry.createdAt / 1000), entry.status.from, entry.status.to]
      )
    })
  }

  public async closeOpenConnectionSpans(): Promise<void> {
    const bootTimeSeconds = Math.floor(Date.now() / 1000)

    const affected = await this.databaseManager.execute(
      `WITH ranked AS (
         SELECT "instanceName", "instanceType", "toStatus",
                ROW_NUMBER() OVER (PARTITION BY "instanceName" ORDER BY "createdAt" DESC, "id" DESC) AS rn
         FROM "instanceStatusHistory"
       )
       INSERT INTO "instanceStatusHistory" ("instanceName", "instanceType", "createdAt", "fromStatus", "toStatus")
       SELECT "instanceName", "instanceType", $1, 'connected', 'disconnected'
       FROM ranked
       WHERE rn = 1 AND "toStatus" = 'connected'`,
      [bootTimeSeconds]
    )

    if (affected > 0) {
      this.logger.info(`Closed ${affected} open connected status span(s) from a previous run.`)
    }
  }

  public async getHistory(
    instanceName: string,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<StatusHistoryEntry[]> {
    const statusRows = await this.databaseManager.queryRows<StoredStatusHistoryChange>(
      'SELECT * FROM "instanceStatusHistory" WHERE "instanceName" = $1 AND "createdAt" >= $2 AND "createdAt" <= $3',
      [instanceName, Math.floor(fromTimestamp / 1000), Math.floor(toTimestamp / 1000)]
    )

    const entries: StatusHistoryEntry[] = statusRows.map((entry) => ({
      id: entry.id,
      instanceName: entry.instanceName,
      instanceType: entry.instanceType,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      createdAt: entry.createdAt * 1000,
      entryType: StatusHistoryEntryType.Status as const
    }))

    return entries.toSorted((a, b) => a.createdAt - b.createdAt)
  }
}

export type StatusHistoryEntry = StatusHistoryChange

type StatusHistoryChange = { fromStatus: Status; toStatus: Status } & {
  entryType: StatusHistoryEntryType.Status
  id: number
} & InstanceIdentifier & { createdAt: number }

enum StatusHistoryEntryType {
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
