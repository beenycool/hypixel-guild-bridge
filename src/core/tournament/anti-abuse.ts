import type { Logger } from 'log4js'

import type { DatabaseManager } from '../../common/database-manager.js'
import { UserRateLimiter } from '../../utility/rate-limiter-map.js'

interface AbuseCheckResult {
  allowed: boolean
  reason?: string
}

export class AntiAbuse {
  private readonly signupLimiter = new UserRateLimiter(1, 10_000)
  private readonly forfeitTracker = new Map<string, { opponent: string; count: number }[]>()
  private readonly overrideTracker = new Map<string, number>()

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
    const history = this.forfeitTracker.get(playerUuid) ?? []
    const entry = history.find((h) => h.opponent === opponentUuid)
    if (entry && entry.count >= 3) {
      return Promise.resolve({ allowed: false, reason: 'Suspicious forfeit pattern detected.' })
    }
    return Promise.resolve({ allowed: true })
  }

  recordForfeit(playerUuid: string, opponentUuid: string): void {
    const history = this.forfeitTracker.get(playerUuid) ?? []
    const entry = history.find((h) => h.opponent === opponentUuid)
    if (entry) {
      entry.count++
    } else {
      history.push({ opponent: opponentUuid, count: 1 })
      this.forfeitTracker.set(playerUuid, history)
    }
  }

  checkFalseReporting(adminDiscordId: string): Promise<AbuseCheckResult> {
    const overrides = this.overrideTracker.get(adminDiscordId) ?? 0
    if (overrides >= 3) {
      return Promise.resolve({ allowed: false, reason: 'High admin override rate detected.' })
    }
    return Promise.resolve({ allowed: true })
  }

  recordAdminOverride(adminDiscordId: string): void {
    const current = this.overrideTracker.get(adminDiscordId) ?? 0
    this.overrideTracker.set(adminDiscordId, current + 1)
  }

  async checkAltAccounts(tournamentId: number, playerUuids: string[]): Promise<AbuseCheckResult> {
    if (playerUuids.length <= 1) return { allowed: true }
    try {
      const rows = await this.databaseManager.queryRows<{ uuid: string; discordId: string }>(
        'SELECT "uuid", "discordId" FROM "links" WHERE "uuid" = ANY($1)',
        [playerUuids]
      )
      const discordMap = new Map<string, string[]>()
      for (const row of rows) {
        const existing = discordMap.get(row.discordId) ?? []
        existing.push(row.uuid)
        discordMap.set(row.discordId, existing)
      }
      for (const [discordId, uuids] of discordMap) {
        if (uuids.length > 1) {
          return { allowed: false, reason: `Multiple accounts linked to Discord <@${discordId}>: ${uuids.join(', ')}` }
        }
      }
    } catch (error) {
      this.logger?.error('Alt check failed:', error)
    }
    return { allowed: true }
  }
}
