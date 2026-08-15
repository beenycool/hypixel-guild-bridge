import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(`SELECT setval('"AllMembers_id_seq"', COALESCE((SELECT MAX("id") FROM "AllMembers"), 0) + 1)`)
  await query.execute(
    `SELECT setval('"OnlineMembers_id_seq"', COALESCE((SELECT MAX("id") FROM "OnlineMembers"), 0) + 1)`
  )
}

export async function down(): Promise<void> {}
