import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(
    `ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "bracketFormat" TEXT NOT NULL DEFAULT 'single-elim'`
  )
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "bracketFormat"`)
}
