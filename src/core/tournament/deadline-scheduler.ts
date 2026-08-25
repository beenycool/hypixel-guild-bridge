import type { Logger } from 'log4js'

import type { DatabaseManager } from '../../common/database-manager.js'

import type { MatchManager } from './match-manager.js'
import type { TournamentNotifications } from './tournament-notifications.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from './types.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from './types.js'

export class DeadlineScheduler {
  private timer?: NodeJS.Timeout
  private isRunning = false
  private readonly checkinRemindersSent = new Map<number, number>()
  private readonly autoStartCooldown = new Map<number, number>()
  private static readonly AutoStartCooldownSeconds = 30 * 60

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly matchManager: MatchManager,
    private readonly notifications: TournamentNotifications,
    private readonly logger: Logger,
    private readonly getPlayerNames: (tournamentId: number) => Promise<Map<number, string>>,
    private readonly startTournament: (tournamentId: number) => Promise<void>
  ) {}

  public start(): void {
    this.timer = setInterval(
      () => {
        this.checkDeadlines().catch((error: unknown) => {
          this.logger.error('Error checking tournament deadlines:', error)
        })
      },
      5 * 60 * 1000
    )
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  public async checkDeadlines(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    try {
      const now = Math.floor(Date.now() / 1000)
      this.logger.debug(`DeadlineScheduler: Running check at timestamp ${now}`)

      const activeTournaments = await this.databaseManager.queryRows<Tournament>(
        'SELECT * FROM "tournaments" WHERE "status" = $1',
        [TournamentStatus.Active]
      )

      for (const tournament of activeTournaments) {
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

          const timeRemaining = match.deadlineAt - now

          if (now >= match.deadlineAt) {
            this.logger.info(`Match ${match.id}: Deadline expired (was ${match.deadlineAt}), auto-resolving`)
            await this.matchManager.handleDeadlineExpiry(match.id).catch((error: unknown) => {
              this.logger.error(`Failed to handle deadline expiry for match ${match.id}:`, error)
            })
            continue
          }

          const twentyFourHours = 24 * 3600
          if (now >= match.deadlineAt - twentyFourHours && match.warningsSent === 0) {
            this.logger.info(
              `Match ${match.id}: Sending 24h warning (deadline=${match.deadlineAt}, ${Math.floor(timeRemaining / 3600)}h remaining)`
            )

            await this.databaseManager.execute('UPDATE "tournament_matches" SET "warningsSent" = 1 WHERE "id" = $1', [
              match.id
            ])
            match.warningsSent = 1

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

      const signupTournaments = await this.databaseManager.queryRows<Tournament>(
        'SELECT * FROM "tournaments" WHERE "status" = $1 AND "checkinOpensAt" IS NOT NULL AND "checkinOpensAt" <= $2',
        [TournamentStatus.Signup, now]
      )

      for (const tournament of signupTournaments) {
        if (tournament.checkinClosesAt !== undefined && now >= tournament.checkinClosesAt) {
          continue
        }

        if (
          tournament.checkinClosesAt !== undefined &&
          now >= tournament.checkinClosesAt - 3600 &&
          this.checkinRemindersSent.get(tournament.id) !== tournament.checkinClosesAt
        ) {
          this.logger.info(`Tournament ${tournament.id}: Check-in closing soon, sending reminders`)
          const uncheckinPlayers = await this.databaseManager.queryRows<TournamentPlayer>(
            'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND ("checkedInAt" IS NULL OR "status" = $2)',
            [tournament.id, PlayerStatus.Registered]
          )

          this.logger.info(`Tournament ${tournament.id}: Reminding ${uncheckinPlayers.length} player(s) to check in`)
          for (const player of uncheckinPlayers) {
            await this.notifications
              .sendWhisper(
                tournament.bridgeId,
                player.playerUuid,
                `⚠️ Tournament "${tournament.name}" check-in closes soon! Use \`!tournament checkin\` to confirm participation.`
              )
              .catch(() => undefined)
          }
          this.checkinRemindersSent.set(tournament.id, tournament.checkinClosesAt)
        }
      }

      const dueTournaments = await this.databaseManager.queryRows<Tournament>(
        'SELECT * FROM "tournaments" WHERE "status" = $1 AND "startedAtUnix" IS NOT NULL AND "startedAtUnix" <= $2',
        [TournamentStatus.Signup, now]
      )
      for (const tournament of dueTournaments) {
        const lastAttempt = this.autoStartCooldown.get(tournament.id)
        if (lastAttempt !== undefined && now - lastAttempt < DeadlineScheduler.AutoStartCooldownSeconds) {
          continue
        }

        this.autoStartCooldown.set(tournament.id, now)
        this.logger.info(
          `Tournament ${tournament.id}: Scheduled start time reached (${tournament.startedAtUnix}), auto-starting`
        )
        try {
          await this.startTournament(tournament.id)
        } catch (error: unknown) {
          this.logger.error(`Tournament ${tournament.id}: Failed to auto-start tournament`, error)
        }
      }

      this.pruneTrackingMaps(activeTournaments, signupTournaments, dueTournaments)
    } finally {
      this.isRunning = false
    }
  }

  private pruneTrackingMaps(
    activeTournaments: Tournament[],
    signupTournaments: Tournament[],
    dueTournaments: Tournament[]
  ): void {
    const stillSigningUp = new Set<number>()
    for (const tournament of [...signupTournaments, ...dueTournaments]) {
      stillSigningUp.add(tournament.id)
    }
    for (const tournament of activeTournaments) {
      stillSigningUp.delete(tournament.id)
    }

    for (const id of this.checkinRemindersSent.keys()) {
      if (!stillSigningUp.has(id)) this.checkinRemindersSent.delete(id)
    }
    for (const id of this.autoStartCooldown.keys()) {
      if (!stillSigningUp.has(id)) this.autoStartCooldown.delete(id)
    }
  }
}
