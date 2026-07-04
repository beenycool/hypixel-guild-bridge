import type { Logger } from 'log4js'

import type { DatabaseManager } from '../../common/database-manager.js'

import type { MatchManager } from './match-manager.js'
import type { TournamentNotifications } from './tournament-notifications.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from './types.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from './types.js'

export class DeadlineScheduler {
  private intervalHandle: NodeJS.Timeout | undefined = undefined
  private isRunning = false

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly matchManager: MatchManager,
    private readonly notifications: TournamentNotifications,
    private readonly logger: Logger,
    private readonly getPlayerNames: (tournamentId: number) => Promise<Map<number, string>>
  ) {}

  public start(): void {
    // Run every 5 minutes
    this.intervalHandle = setInterval(
      () => {
        this.checkDeadlines().catch((error: unknown) => {
          this.logger.error('Error checking tournament deadlines:', error)
        })
      },
      5 * 60 * 1000
    )
  }

  public stop(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
  }

  public async checkDeadlines(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    try {
      const now = Math.floor(Date.now() / 1000)

      // Get active tournaments
      const activeTournaments = await this.databaseManager.queryRows<Tournament>(
        'SELECT * FROM "tournaments" WHERE "status" = $1',
        [TournamentStatus.Active]
      )

      for (const tournament of activeTournaments) {
        // Get matches that are ACTIVE, REPORTED, or DISPUTED and have a deadline
        const matches = await this.databaseManager.queryRows<TournamentMatch>(
          `SELECT * FROM "tournament_matches"
           WHERE "tournamentId" = $1
             AND "status" IN ($2, $3, $4)
             AND "deadlineAt" IS NOT NULL`,
          [tournament.id, MatchStatus.Active, MatchStatus.Reported, MatchStatus.Disputed]
        )

        const names = await this.getPlayerNames(tournament.id)

        for (const match of matches) {
          if (match.deadlineAt === undefined) continue

          // 1. Expired deadline
          if (now >= match.deadlineAt) {
            this.logger.info(`Match ${match.id} deadline expired. Auto-resolving...`)
            await this.matchManager.handleDeadlineExpiry(match.id).catch((error: unknown) => {
              this.logger.error(`Failed to handle deadline expiry for match ${match.id}:`, error)
            })
            continue
          }

          // 2. 24h Warning
          const twentyFourHours = 24 * 3600
          if (now >= match.deadlineAt - twentyFourHours && match.warningsSent === 0) {
            this.logger.info(`Sending 24h warning for match ${match.id}`)

            // Update warning sent flag
            await this.databaseManager.execute('UPDATE "tournament_matches" SET "warningsSent" = 1 WHERE "id" = $1', [
              match.id
            ])
            match.warningsSent = 1

            // Fetch players to get UUIDs
            const p1 =
              match.player1Id === undefined
                ? undefined
                : await this.databaseManager.queryOne<TournamentPlayer>(
                    'SELECT * FROM "tournament_players" WHERE "id" = $1',
                    [match.player1Id]
                  )
            const p2 =
              match.player2Id === undefined
                ? undefined
                : await this.databaseManager.queryOne<TournamentPlayer>(
                    'SELECT * FROM "tournament_players" WHERE "id" = $1',
                    [match.player2Id]
                  )

            if (p1 !== undefined && p2 !== undefined) {
              const p1Name = names.get(p1.id) ?? 'Player 1'
              const p2Name = names.get(p2.id) ?? 'Player 2'

              await this.notifications
                .sendDeadlineWarning(tournament.bridgeId, match, p1.playerUuid, p2.playerUuid, p1Name, p2Name)
                .catch((error: unknown) => {
                  this.logger.error(`Failed to send deadline warning for match ${match.id}:`, error)
                })
            }
          }
        }
      }

      // Also check for SIGNUP tournaments with open check-in windows
      const signupTournaments = await this.databaseManager.queryRows<Tournament>(
        'SELECT * FROM "tournaments" WHERE "status" = $1 AND "checkinOpensAt" IS NOT NULL AND "checkinOpensAt" <= $2',
        [TournamentStatus.Signup, now]
      )

      for (const tournament of signupTournaments) {
        const thirtyMinBeforeClose = 30 * 60
        if (tournament.checkinClosesAt !== undefined && now >= tournament.checkinClosesAt) {
          continue
        }

        if (tournament.checkinClosesAt !== undefined && now >= tournament.checkinClosesAt - 3600) {
          const uncheckinPlayers = await this.databaseManager.queryRows<TournamentPlayer>(
            'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND ("checkedInAt" IS NULL OR "status" = $2)',
            [tournament.id, PlayerStatus.Registered]
          )

          for (const player of uncheckinPlayers) {
            await this.notifications
              .sendWhisper(
                tournament.bridgeId,
                player.playerUuid,
                `⚠️ Tournament "${tournament.name}" check-in closes soon! Use !tournament checkin to confirm participation.`
              )
              .catch(() => undefined)
          }
        }
      }
    } finally {
      this.isRunning = false
    }
  }
}
