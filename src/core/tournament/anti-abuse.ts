import type { Logger } from 'log4js'

import type { DatabaseManager } from '../../common/database-manager.js'
import { UserRateLimiter } from '../../utility/rate-limiter-map.js'

interface AbuseCheckResult {
  allowed: boolean
  reason?: string
}

export class AntiAbuse {
  private readonly signupLimiter = new UserRateLimiter(1, 10_000)
  private readonly forfeitTracker = new Map<string, { opponent: string; timestamps: number[] }[]>()
  private readonly overrideTracker = new Map<string, number[]>()
  private static readonly ForfeitWindowMs = 24 * 60 * 60 * 1000
  private static readonly OverrideWindowMs = 6 * 60 * 60 * 1000

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly logger?: Logger
  ) {}

  checkSignupRate(userId: string): AbuseCheckResult {
    if (!this.signupLimiter.tryAcquire(userId)) {
      return { allowed: false, reason: 'You are joining/leaving too fast. Please slow down.' }
    }
    return { allowed: true }
  }

  checkForfeitPattern(playerUuid: string, opponentUuid: string): Promise<AbuseCheckResult> {
    const cutoff = Date.now() - AntiAbuse.ForfeitWindowMs
    const entry = (this.forfeitTracker.get(playerUuid) ?? []).find((h) => h.opponent === opponentUuid)
    if (entry && this.pruneTimestamps(entry.timestamps, cutoff).length >= 3) {
      return Promise.resolve({ allowed: false, reason: 'Suspicious forfeit pattern detected.' })
    }
    return Promise.resolve({ allowed: true })
  }

  recordForfeit(playerUuid: string, opponentUuid: string): void {
    const cutoff = Date.now() - AntiAbuse.ForfeitWindowMs
    const history = (this.forfeitTracker.get(playerUuid) ?? [])
      .map((entry) => ({ opponent: entry.opponent, timestamps: this.pruneTimestamps(entry.timestamps, cutoff) }))
      .filter((entry) => entry.timestamps.length > 0)

    const entry = history.find((h) => h.opponent === opponentUuid)
    if (entry) {
      entry.timestamps.push(Date.now())
    } else {
      history.push({ opponent: opponentUuid, timestamps: [Date.now()] })
    }
    this.forfeitTracker.set(playerUuid, history)
  }

  checkFalseReporting(adminDiscordId: string): Promise<AbuseCheckResult> {
    const cutoff = Date.now() - AntiAbuse.OverrideWindowMs
    const overrides = this.pruneTimestamps(this.overrideTracker.get(adminDiscordId) ?? [], cutoff)
    if (this.overrideTracker.has(adminDiscordId)) {
      if (overrides.length === 0) this.overrideTracker.delete(adminDiscordId)
      else this.overrideTracker.set(adminDiscordId, overrides)
    }
    if (overrides.length >= 3) {
      return Promise.resolve({ allowed: false, reason: 'High admin override rate detected.' })
    }
    return Promise.resolve({ allowed: true })
  }

  recordAdminOverride(adminDiscordId: string): void {
    const cutoff = Date.now() - AntiAbuse.OverrideWindowMs
    const timestamps = this.pruneTimestamps(this.overrideTracker.get(adminDiscordId) ?? [], cutoff)
    timestamps.push(Date.now())
    this.overrideTracker.set(adminDiscordId, timestamps)
  }

  async checkAltAccounts(tournamentId: number, playerUuids: string[]): Promise<AbuseCheckResult> {
    if (playerUuids.length <= 1) return { allowed: true }
    try {
      const rows = await this.databaseManager.queryRows<{ uuid: string; discordId: string | null }>(
        'SELECT "uuid", "discordId" FROM "links" WHERE "uuid" = ANY($1)',
        [playerUuids]
      )
      const discordMap = new Map<string, string[]>()
      for (const row of rows) {
        if (row.discordId === null || row.discordId.length === 0) continue
        const existing = discordMap.get(row.discordId) ?? []
        existing.push(row.uuid)
        discordMap.set(row.discordId, existing)
      }
      for (const [discordId, uuids] of discordMap) {
        if (uuids.length > 1) {
          return { allowed: false, reason: `Multiple accounts linked to Discord <@${discordId}>: ${uuids.join(', ')}` }
        }
      }
    } catch (error: unknown) {
      this.logger?.error('Alt check failed:', error)
    }
    return { allowed: true }
  }

  private pruneTimestamps(timestamps: number[], cutoff: number): number[] {
    return timestamps.filter((t) => t > cutoff)
  }
}
