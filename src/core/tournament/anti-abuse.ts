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

  private static scopedKey(bridgeId: string | undefined, key: string): string {
    return `${bridgeId ?? 'none'}:${key}`
  }

  checkSignupRate(userId: string, bridgeId?: string): AbuseCheckResult {
    if (!this.signupLimiter.tryAcquire(AntiAbuse.scopedKey(bridgeId, userId))) {
      return { allowed: false, reason: 'You are joining/leaving too fast. Please slow down.' }
    }
    return { allowed: true }
  }

  checkForfeitPattern(playerUuid: string, opponentUuid: string, bridgeId?: string): Promise<AbuseCheckResult> {
    const cutoff = Date.now() - AntiAbuse.ForfeitWindowMs
    const trackerKey = AntiAbuse.scopedKey(bridgeId, playerUuid)
    const entry = (this.forfeitTracker.get(trackerKey) ?? []).find((h) => h.opponent === opponentUuid)
    if (entry && this.pruneTimestamps(entry.timestamps, cutoff).length >= 3) {
      return Promise.resolve({ allowed: false, reason: 'Suspicious forfeit pattern detected.' })
    }
    return Promise.resolve({ allowed: true })
  }

  recordForfeit(playerUuid: string, opponentUuid: string, bridgeId?: string): void {
    const cutoff = Date.now() - AntiAbuse.ForfeitWindowMs
    const trackerKey = AntiAbuse.scopedKey(bridgeId, playerUuid)
    const history = (this.forfeitTracker.get(trackerKey) ?? [])
      .map((entry) => ({ opponent: entry.opponent, timestamps: this.pruneTimestamps(entry.timestamps, cutoff) }))
      .filter((entry) => entry.timestamps.length > 0)

    const entry = history.find((h) => h.opponent === opponentUuid)
    if (entry) {
      entry.timestamps.push(Date.now())
    } else {
      history.push({ opponent: opponentUuid, timestamps: [Date.now()] })
    }
    this.forfeitTracker.set(trackerKey, history)
  }

  checkFalseReporting(adminDiscordId: string, bridgeId?: string): Promise<AbuseCheckResult> {
    const cutoff = Date.now() - AntiAbuse.OverrideWindowMs
    const trackerKey = AntiAbuse.scopedKey(bridgeId, adminDiscordId)
    const overrides = this.pruneTimestamps(this.overrideTracker.get(trackerKey) ?? [], cutoff)
    if (this.overrideTracker.has(trackerKey)) {
      if (overrides.length === 0) this.overrideTracker.delete(trackerKey)
      else this.overrideTracker.set(trackerKey, overrides)
    }
    if (overrides.length >= 3) {
      return Promise.resolve({ allowed: false, reason: 'High admin override rate detected.' })
    }
    return Promise.resolve({ allowed: true })
  }

  recordAdminOverride(adminDiscordId: string, bridgeId?: string): void {
    const cutoff = Date.now() - AntiAbuse.OverrideWindowMs
    const trackerKey = AntiAbuse.scopedKey(bridgeId, adminDiscordId)
    const timestamps = this.pruneTimestamps(this.overrideTracker.get(trackerKey) ?? [], cutoff)
    timestamps.push(Date.now())
    this.overrideTracker.set(trackerKey, timestamps)
  }

  async checkAltAccounts(tournamentId: number, playerUuids: string[], bridgeId?: string): Promise<AbuseCheckResult> {
    if (playerUuids.length <= 1) return { allowed: true }
    try {
      const rows =
        bridgeId === undefined
          ? await this.databaseManager.queryRows<{ uuid: string; discordId: string | null }>(
              'SELECT "uuid", "discordId" FROM "links" WHERE "uuid" = ANY($1)',
              [playerUuids]
            )
          : await this.databaseManager.queryRows<{ uuid: string; discordId: string | null }>(
              'SELECT "uuid", "discordId" FROM "links" WHERE "uuid" = ANY($1) AND "bridgeId" = $2',
              [playerUuids, bridgeId]
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
