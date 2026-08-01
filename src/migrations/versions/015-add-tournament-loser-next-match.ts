import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "loserNextMatchId" INTEGER`)
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "tournament_matches" DROP COLUMN IF EXISTS "loserNextMatchId"`)
}
