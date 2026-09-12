import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(
    `CREATE INDEX IF NOT EXISTS "chatMessagesBridgeCreatedAtIndex" ON "ChatMessages" ("bridgeId", "createdAt" DESC)`
  )
  await query.execute(
    `CREATE INDEX IF NOT EXISTS "discordTempInteractionsBridgeIndex" ON "discordTempInteractions" ("bridgeId")`
  )
  await query.execute(`CREATE INDEX IF NOT EXISTS "statMonitorsBridgeIndex" ON "statMonitors" ("bridgeId")`)
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`DROP INDEX IF EXISTS "chatMessagesBridgeCreatedAtIndex"`)
  await query.execute(`DROP INDEX IF EXISTS "discordTempInteractionsBridgeIndex"`)
  await query.execute(`DROP INDEX IF EXISTS "statMonitorsBridgeIndex"`)
}
