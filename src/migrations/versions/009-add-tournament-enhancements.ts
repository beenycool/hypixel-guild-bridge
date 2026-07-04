import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  // 1. Add new columns to "tournaments"
  await query.execute(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "categoryChannelId" TEXT`)
  await query.execute(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "liveChannelId" TEXT`)
  await query.execute(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "checkinOpensAt" INTEGER`)
  await query.execute(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "checkinClosesAt" INTEGER`)
  await query.execute(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "startedAtUnix" INTEGER`)

  // 2. Add new columns to "tournament_players"
  await query.execute(`ALTER TABLE "tournament_players" ADD COLUMN IF NOT EXISTS "checkedInAt" INTEGER`)

  // 3. Add new columns to "tournament_matches"
  await query.execute(
    `ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "deadlineExtensionMinutes" INTEGER NOT NULL DEFAULT 0`
  )
  await query.execute(
    `ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "manuallyExtended" INTEGER NOT NULL DEFAULT 0`
  )
  await query.execute(
    `ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "hadProofAttachment" INTEGER NOT NULL DEFAULT 0`
  )
}

export async function down(query: QueryInterface): Promise<void> {
  // Rollback: drop all added columns.
  // Note: this will cause data loss. For safety, comment out the DROPs and manually verify before running.
  await query.execute(`ALTER TABLE "tournament_matches" DROP COLUMN IF EXISTS "hadProofAttachment"`)
  await query.execute(`ALTER TABLE "tournament_matches" DROP COLUMN IF EXISTS "manuallyExtended"`)
  await query.execute(`ALTER TABLE "tournament_matches" DROP COLUMN IF EXISTS "deadlineExtensionMinutes"`)
  await query.execute(`ALTER TABLE "tournament_players" DROP COLUMN IF EXISTS "checkedInAt"`)
  await query.execute(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "startedAtUnix"`)
  await query.execute(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "checkinClosesAt"`)
  await query.execute(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "checkinOpensAt"`)
  await query.execute(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "liveChannelId"`)
  await query.execute(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "categoryChannelId"`)
}
