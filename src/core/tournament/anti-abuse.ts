import { UserRateLimiter } from '../../utility/rate-limiter-map.js'
import type { DatabaseManager } from '../../common/database-manager.js'

export interface AbuseCheckResult {
  allowed: boolean
  reason?: string
}

export class AntiAbuse {
  private readonly signupLimiter = new UserRateLimiter(1, 10_000)
  private readonly forfeitTracker = new Map<string, { opponent: string; count: number }[]>()
  private readonly overrideTracker = new Map<string, number>()

  constructor(private readonly databaseManager: DatabaseManager) {}

  checkSignupRate(userId: string): AbuseCheckResult {
    if (!this.signupLimiter.tryAcquire(userId)) {
      return { allowed: false, reason: 'Please slow down. You are joining/leaving too fast.' }
    }
    return { allowed: true }
  }

  async checkForfeitPattern(playerUuid: string, opponentUuid: string): Promise<AbuseCheckResult> {
    const history = this.forfeitTracker.get(playerUuid) ?? []
    const sameOpponent = history.filter((h) => h.opponent === opponentUuid)

    if (sameOpponent.length >= 3) {
      return { allowed: false, reason: 'FLAGGED: Suspicious forfeit pattern' }
    }

    return { allowed: true }
  }

  recordForfeit(playerUuid: string, opponentUuid: string): void {
    const history = this.forfeitTracker.get(playerUuid) ?? []
    history.push({ opponent: opponentUuid, count: (history.find((h) => h.opponent === opponentUuid)?.count ?? 0) + 1 })
    this.forfeitTracker.set(playerUuid, history)
  }

  async checkFalseReporting(adminDiscordId: string): Promise<AbuseCheckResult> {
    const overrides = this.overrideTracker.get(adminDiscordId) ?? 0
    if (overrides >= 3) {
      return { allowed: false, reason: 'FLAGGED: High admin override rate' }
    }
    return { allowed: true }
  }

  recordAdminOverride(adminDiscordId: string): void {
    const current = this.overrideTracker.get(adminDiscordId) ?? 0
    this.overrideTracker.set(adminDiscordId, current + 1)
  }

  /**
   * Check for potential alt accounts in the same tournament.
   * Cross-references mojang table for shared identifiers.
   */
  async checkAltAccounts(tournamentId: number, playerUuids: string[]): Promise<AbuseCheckResult> {
    try {
      const rows = await this.databaseManager.queryRows<{ player_uuid: string; ip: string | null }>(
        'SELECT player_uuid, ip FROM mojang WHERE player_uuid = ANY($1)',
        [playerUuids]
      )

      const ipMap = new Map<string, string[]>()
      for (const row of rows) {
        if (!row.ip) continue
        const existing = ipMap.get(row.ip) ?? []
        existing.push(row.player_uuid)
        ipMap.set(row.ip, existing)
      }

      for (const [ip, uuids] of ipMap) {
        if (uuids.length > 1) {
          return { allowed: false, reason: `FLAGGED: Potential alt accounts sharing IP ${ip}` }
        }
      }
    } catch {
      // mojang table may not exist — skip gracefully
    }

    return { allowed: true }
  }
}
