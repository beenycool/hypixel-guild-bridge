import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute('ALTER TABLE "ChatMessages" ADD COLUMN IF NOT EXISTS "bridgeId" TEXT')
  await query.execute('ALTER TABLE "ChatMessages" ADD COLUMN IF NOT EXISTS "username" TEXT')
  await query.execute('ALTER TABLE "ChatMessages" ADD COLUMN IF NOT EXISTS "discordId" TEXT')
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute('ALTER TABLE "ChatMessages" DROP COLUMN IF EXISTS "bridgeId"')
  await query.execute('ALTER TABLE "ChatMessages" DROP COLUMN IF EXISTS "username"')
  await query.execute('ALTER TABLE "ChatMessages" DROP COLUMN IF EXISTS "discordId"')
}
