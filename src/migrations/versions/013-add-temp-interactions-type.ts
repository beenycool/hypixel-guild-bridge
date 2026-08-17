/* eslint-disable unicorn/prevent-abbreviations */
import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "discordTempInteractions" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'online-offline'`)
  await query.execute(`ALTER TABLE "discordTempInteractions" ADD COLUMN "bridgeId" TEXT`)
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "discordTempInteractions" DROP COLUMN "bridgeId"`)
  await query.execute(`ALTER TABLE "discordTempInteractions" DROP COLUMN "type"`)
}
