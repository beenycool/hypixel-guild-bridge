import type { QueryInterface } from '../runner.js'

export async function up(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "rankupPendingReviews" ADD COLUMN IF NOT EXISTS "weeklyGexp" INTEGER`)
  await query.execute(`ALTER TABLE "rankupPendingReviews" ADD COLUMN IF NOT EXISTS "requiredGexp" INTEGER`)
  await query.execute(`ALTER TABLE "rankupPendingReviews" ADD COLUMN IF NOT EXISTS "daysInGuild" REAL`)
  await query.execute(`ALTER TABLE "rankupPendingReviews" ADD COLUMN IF NOT EXISTS "minDaysInGuild" REAL`)
  await query.execute(`ALTER TABLE "rankupPendingReviews" ADD COLUMN IF NOT EXISTS "daysSinceLastSeen" REAL`)
}

export async function down(query: QueryInterface): Promise<void> {
  await query.execute(`ALTER TABLE "rankupPendingReviews" DROP COLUMN IF EXISTS "weeklyGexp"`)
  await query.execute(`ALTER TABLE "rankupPendingReviews" DROP COLUMN IF EXISTS "requiredGexp"`)
  await query.execute(`ALTER TABLE "rankupPendingReviews" DROP COLUMN IF EXISTS "daysInGuild"`)
  await query.execute(`ALTER TABLE "rankupPendingReviews" DROP COLUMN IF EXISTS "minDaysInGuild"`)
  await query.execute(`ALTER TABLE "rankupPendingReviews" DROP COLUMN IF EXISTS "daysSinceLastSeen"`)
}
