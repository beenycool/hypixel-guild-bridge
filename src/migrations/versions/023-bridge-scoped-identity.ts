import type { QueryInterface } from '../runner.js'

interface ConfigurationRow {
  value: string
}

async function getConfiguredBridgeIds(query: QueryInterface): Promise<string[]> {
  const rows = await query.queryRows<ConfigurationRow>(
    `SELECT "value" FROM "configurations" WHERE "category" = 'bridges' AND "name" = 'bridgeIds'`
  )
  if (rows.length === 0) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(rows[0].value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue

    const trimmed = entry.trim()
    if (trimmed.length === 0) continue

    const normalized = trimmed.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(trimmed)
  }

  return result
}

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "links" ADD COLUMN IF NOT EXISTS "bridgeId" TEXT NOT NULL DEFAULT ''`)
  await query.execute(
    `ALTER TABLE "autocompleteUsernames" ADD COLUMN IF NOT EXISTS "bridgeId" TEXT NOT NULL DEFAULT ''`
  )
  await query.execute(`ALTER TABLE "autocompleteRanks" ADD COLUMN IF NOT EXISTS "bridgeId" TEXT NOT NULL DEFAULT ''`)
  await query.execute(`ALTER TABLE "discordInstanceHistoryButton" ADD COLUMN IF NOT EXISTS "bridgeId" TEXT`)

  await query.execute(`ALTER TABLE "links" DROP CONSTRAINT IF EXISTS "links_pkey"`)
  await query.execute(`ALTER TABLE "links" DROP CONSTRAINT IF EXISTS "links_discordId_key"`)
  await query.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "linksBridgeUuidUnique" ON "links" ("bridgeId", "uuid")`)
  await query.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "linksBridgeDiscordUnique" ON "links" ("bridgeId", "discordId")`
  )

  await query.execute(`ALTER TABLE "autocompleteUsernames" DROP CONSTRAINT IF EXISTS "autocompleteUsernames_pkey"`)
  await query.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "autocompleteUsernamesBridgeUnique" ON "autocompleteUsernames" ("bridgeId", "loweredContent")`
  )
  await query.execute(`ALTER TABLE "autocompleteRanks" DROP CONSTRAINT IF EXISTS "autocompleteRanks_pkey"`)
  await query.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "autocompleteRanksBridgeUnique" ON "autocompleteRanks" ("bridgeId", "loweredContent")`
  )

  const bridgeIds = await getConfiguredBridgeIds(query)
  for (const bridgeId of bridgeIds) {
    await query.execute(
      `INSERT INTO "links" ("bridgeId", "uuid", "discordId")
       SELECT $1, "uuid", "discordId" FROM "links" WHERE "bridgeId" = ''
       ON CONFLICT DO NOTHING`,
      [bridgeId]
    )
    await query.execute(
      `INSERT INTO "autocompleteUsernames" ("bridgeId", "loweredContent", "content", "timestamp")
       SELECT $1, "loweredContent", "content", "timestamp" FROM "autocompleteUsernames" WHERE "bridgeId" = ''
       ON CONFLICT DO NOTHING`,
      [bridgeId]
    )
    await query.execute(
      `INSERT INTO "autocompleteRanks" ("bridgeId", "loweredContent", "content", "timestamp")
       SELECT $1, "loweredContent", "content", "timestamp" FROM "autocompleteRanks" WHERE "bridgeId" = ''
       ON CONFLICT DO NOTHING`,
      [bridgeId]
    )
  }
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`DELETE FROM "links" WHERE "bridgeId" <> ''`)
  await query.execute(`DROP INDEX IF EXISTS "linksBridgeUuidUnique"`)
  await query.execute(`DROP INDEX IF EXISTS "linksBridgeDiscordUnique"`)
  await query.execute(`ALTER TABLE "links" DROP CONSTRAINT IF EXISTS "links_pkey"`)
  await query.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "linksOldUuidUnique" ON "links" ("uuid")`)
  await query.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "links_discordId_key" ON "links" ("discordId")`)
  await query.execute(`ALTER TABLE "links" DROP COLUMN IF EXISTS "bridgeId"`)

  await query.execute(`DELETE FROM "autocompleteUsernames" WHERE "bridgeId" <> ''`)
  await query.execute(`DROP INDEX IF EXISTS "autocompleteUsernamesBridgeUnique"`)
  await query.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "autocompleteUsernamesOldUnique" ON "autocompleteUsernames" ("loweredContent")`
  )
  await query.execute(`ALTER TABLE "autocompleteUsernames" DROP COLUMN IF EXISTS "bridgeId"`)

  await query.execute(`DELETE FROM "autocompleteRanks" WHERE "bridgeId" <> ''`)
  await query.execute(`DROP INDEX IF EXISTS "autocompleteRanksBridgeUnique"`)
  await query.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "autocompleteRanksOldUnique" ON "autocompleteRanks" ("loweredContent")`
  )
  await query.execute(`ALTER TABLE "autocompleteRanks" DROP COLUMN IF EXISTS "bridgeId"`)

  await query.execute(`ALTER TABLE "discordInstanceHistoryButton" DROP COLUMN IF EXISTS "bridgeId"`)
}
