import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(
    `ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "checkinWindowMinutes" INTEGER NOT NULL DEFAULT 60`
  )
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "checkinWindowMinutes"`)
}
