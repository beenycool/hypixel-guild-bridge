import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(
    `CREATE TABLE IF NOT EXISTS "app_settings" (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  )
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`DROP TABLE IF EXISTS "app_settings"`)
}
