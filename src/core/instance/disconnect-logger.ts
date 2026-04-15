import type { DatabaseManager } from '../../common/database-manager'
import Duration from '../../utility/duration'

export class DisconnectLogger {
  private static readonly MaxLife = Duration.days(90)

  constructor(private readonly databaseManager: DatabaseManager) {
    this.databaseManager.registerCleaner(() => {
      const cutoff = Math.floor((Date.now() - DisconnectLogger.MaxLife.toMilliseconds()) / 1000)

      this.databaseManager.enqueueWrite('cleaning disconnect logs', async (database) => {
        await database.query('DELETE FROM "disconnectLogs" WHERE "createdAt" < $1', [cutoff])
      })
    })
  }

  public logDisconnect(instanceName: string, eventType: string, reason: string): void {
    this.databaseManager.enqueueWrite(`saving disconnect log for ${instanceName}`, async (database) => {
      await database.query(
        `INSERT INTO "disconnectLogs" ("instanceName", "eventType", "reason")
         VALUES ($1, $2, $3)`,
        [instanceName, eventType, reason]
      )
    })
  }
}
