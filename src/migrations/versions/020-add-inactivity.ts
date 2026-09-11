import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(
    `CREATE TABLE IF NOT EXISTS "inactivity" (
      "bridgeId" TEXT NOT NULL,
      "uuid" TEXT NOT NULL,
      "discordId" TEXT NOT NULL,
      "createdBy" TEXT NOT NULL DEFAULT '',
      "reason" TEXT NOT NULL,
      "createdAt" INTEGER NOT NULL,
      "expiresAt" INTEGER NOT NULL,
      PRIMARY KEY ("bridgeId", "uuid")
    )`
  )
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`DROP TABLE IF EXISTS "inactivity" CASCADE`)
}
