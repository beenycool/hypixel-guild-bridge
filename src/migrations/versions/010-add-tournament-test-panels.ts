import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(
    `CREATE TABLE IF NOT EXISTS "tournamentTestPanels" (
      "messageId" TEXT PRIMARY KEY,
      "channelId" TEXT NOT NULL,
      "guildId" TEXT NOT NULL,
      "tournamentId" INTEGER NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
      "bridgeId" TEXT NOT NULL,
      "currentStep" INTEGER NOT NULL DEFAULT 0,
      "historyJson" TEXT NOT NULL DEFAULT '[]',
      "createdAt" INTEGER NOT NULL DEFAULT CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER)
    )`
  )
  await query.execute(
    `CREATE INDEX IF NOT EXISTS "idx_ttestpanels_tournamentId" ON "tournamentTestPanels" ("tournamentId")`
  )
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`DROP TABLE IF EXISTS "tournamentTestPanels" CASCADE`)
}
