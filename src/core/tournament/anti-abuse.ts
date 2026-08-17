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
      this.logger?.info(`AntiAbuse: Rate limit hit for user ${userId}`)
      return { allowed: false, reason: 'Please slow down. You are joining/leaving too fast.' }
    }
    return { allowed: true }
  }

  checkForfeitPattern(playerUuid: string, opponentUuid: string): Promise<AbuseCheckResult> {
    const history = this.forfeitTracker.get(playerUuid) ?? []
    const entry = history.find((h) => h.opponent === opponentUuid)

    if (entry && entry.count >= 3) {
      this.logger?.info(
        `AntiAbuse: Suspicious forfeit pattern — ${playerUuid} forfeiting to ${opponentUuid} (${entry.count}x)`
      )
      return Promise.resolve({ allowed: false, reason: 'FLAGGED: Suspicious forfeit pattern' })
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
    this.logger?.info(`AntiAbuse: Recorded forfeit — ${playerUuid} vs ${opponentUuid}`)
  }

  checkFalseReporting(adminDiscordId: string): Promise<AbuseCheckResult> {
    const overrides = this.overrideTracker.get(adminDiscordId) ?? 0
    if (overrides >= 3) {
      this.logger?.info(`AntiAbuse: High override rate — admin ${adminDiscordId} (${overrides} overrides)`)
      return Promise.resolve({ allowed: false, reason: 'FLAGGED: High admin override rate' })
    }
    return Promise.resolve({ allowed: true })
  }

  recordAdminOverride(adminDiscordId: string): void {
    const current = this.overrideTracker.get(adminDiscordId) ?? 0
    this.overrideTracker.set(adminDiscordId, current + 1)
    this.logger?.info(`AntiAbuse: Recorded admin override — ${adminDiscordId} (total: ${current + 1})`)
  }

  async checkAltAccounts(tournamentId: number, playerUuids: string[]): Promise<AbuseCheckResult> {
    this.logger?.info(
      `AntiAbuse: Checking alt accounts for tournament ${tournamentId} (${playerUuids.length} player(s))`
    )
    if (playerUuids.length <= 1) {
      return { allowed: true }
    }

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
          this.logger?.info(
            `AntiAbuse: Potential alts detected — Discord ID ${discordId} shared by ${uuids.join(', ')}`
          )
          return { allowed: false, reason: `FLAGGED: Potential alt accounts sharing Discord account <@${discordId}>` }
        }
      }
    } catch (error) {
      this.logger?.error('Failed to check alt accounts:', error)
    }

    return { allowed: true }
  }
}
