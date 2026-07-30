import type { Logger } from 'log4js'

import type { DatabaseManager } from '../../common/database-manager.js'

import { validateSeriesScore } from './score-validator.js'
import type { TournamentChannelManager } from './tournament-channel-manager.js'
import type { TournamentNotifications } from './tournament-notifications.js'
import type { Tournament, TournamentMatch, TournamentPlayer, TournamentReport } from './types.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from './types.js'

export class MatchManager {
  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly channelManager: TournamentChannelManager,
    private readonly notifications: TournamentNotifications,
    private readonly getTournament: (id: number) => Promise<Tournament | undefined>,
    private readonly getPlayerNames: (tournamentId: number) => Promise<Map<number, string>>,
    private readonly checkProofAttachment?: (threadId: string) => Promise<boolean>,
    private readonly logger?: Logger
  ) {}

  /**
   * Submit a report for a match.
   */
  public async submitReport(
    matchId: number,
    reporterPlayerId: number,
    claimedWinnerId: number,
    p1Wins: number,
    p2Wins: number
  ): Promise<{ status: MatchStatus; message: string }> {
    this.logger?.info(
      `Match ${matchId}: submitReport — reporterPlayerId=${reporterPlayerId}, claimedWinnerId=${claimedWinnerId}, p1Wins=${p1Wins}, p2Wins=${p2Wins}`
    )

    // Proof attachment check - perform before entering transaction to avoid holding DB locks
    let hasProof = false
    const preMatch = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (preMatch?.discordThreadId !== undefined && this.checkProofAttachment !== undefined) {
      hasProof = await this.checkProofAttachment(preMatch.discordThreadId)
      this.logger?.info(`Match ${matchId}: Proof attachment check — hasProof=${hasProof}`)
    }

    return await this.databaseManager.transaction(async (txClient) => {
      // 1. Lock and fetch match
      const matchResult = await txClient.query<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 FOR UPDATE',
        [matchId]
      )
      const match = matchResult.rows[0]
      if (match === undefined) {
        throw new Error('Match not found.')
      }
      if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
        this.logger?.info(`Match ${matchId}: Report rejected — match already ${match.status}`)
        return { status: match.status, message: 'This match is already completed.' }
      }
      if (match.status === MatchStatus.Disputed) {
        this.logger?.info(`Match ${matchId}: Report rejected — match is disputed`)
        return { status: MatchStatus.Disputed, message: 'This match is under dispute. Please wait for an admin.' }
      }

      if (match.player1Id !== reporterPlayerId && match.player2Id !== reporterPlayerId) {
        throw new Error('You are not a participant in this match.')
      }

      const tournament = await this.getTournament(match.tournamentId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
        throw new Error('Tournament is not active.')
      }

      // Validate score
      const scoreCheck = validateSeriesScore(tournament.bestOf, p1Wins, p2Wins)
      if (!scoreCheck.valid) {
        this.logger?.info(`Match ${matchId}: Score validation failed — ${scoreCheck.message}`)
        return { status: match.status, message: scoreCheck.message }
      }

      // 2. Insert report
      this.logger?.info(
        `Match ${matchId}: Inserting report for reporter=${reporterPlayerId}, claimedWinner=${claimedWinnerId}`
      )
      await txClient.query(
        `INSERT INTO "tournament_reports" ("matchId", "reporterId", "claimedWinnerId", "player1Wins", "player2Wins")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("matchId", "reporterId") DO UPDATE SET
           "claimedWinnerId" = EXCLUDED."claimedWinnerId",
           "player1Wins" = EXCLUDED."player1Wins",
           "player2Wins" = EXCLUDED."player2Wins"`,
        [matchId, reporterPlayerId, claimedWinnerId, p1Wins, p2Wins]
      )

      // Set proof flag using pre-fetched result
      if (hasProof) {
        await txClient.query('UPDATE "tournament_matches" SET "hadProofAttachment" = 1 WHERE "id" = $1', [matchId])
      }

      // 3. Check reports
      const reportsResult = await txClient.query<TournamentReport>(
        'SELECT * FROM "tournament_reports" WHERE "matchId" = $1',
        [matchId]
      )
      const reports = reportsResult.rows

      const expectedReportCount = (match.player1Id === undefined ? 0 : 1) + (match.player2Id === undefined ? 0 : 1)
      let newStatus = MatchStatus.Reported

      if (reports.length === expectedReportCount) {
        const firstReport = reports[0]
        const secondReport = reports[1]

        newStatus =
          reports.length < 2 || firstReport.claimedWinnerId === secondReport.claimedWinnerId
            ? MatchStatus.BothConfirmed
            : MatchStatus.Disputed
      }

      this.logger?.info(
        `Match ${matchId}: Report comparison — reports=${reports.length}/${expectedReportCount}, newStatus=${newStatus}`
      )

      // 4. Update match status
      await txClient.query('UPDATE "tournament_matches" SET "status" = $1 WHERE "id" = $2', [newStatus, matchId])
      match.status = newStatus

      // 5. Take action based on status
      if (newStatus === MatchStatus.BothConfirmed) {
        this.logger?.info(`Match ${matchId}: Both reports agree, resolving with winner ${claimedWinnerId}`)
        await this.resolveWinner(matchId, claimedWinnerId)
        return { status: MatchStatus.Completed, message: 'Match successfully resolved!' }
      } else if (newStatus === MatchStatus.Disputed) {
        this.logger?.info(`Match ${matchId}: Reports conflict — match is disputed`)
        const names = await this.getPlayerNames(match.tournamentId)
        const p1Name = match.player1Id === undefined ? 'Player 1' : (names.get(match.player1Id) ?? 'Player 1')
        const p2Name = match.player2Id === undefined ? 'Player 2' : (names.get(match.player2Id) ?? 'Player 2')

        const r1Claimed = names.get(reports[0].claimedWinnerId) ?? 'Unknown'
        const r2Claimed = names.get(reports[1].claimedWinnerId) ?? 'Unknown'

        await this.notifications.notifyDispute(tournament.bridgeId, match, p1Name, p2Name, r1Claimed, r2Claimed)
        return { status: MatchStatus.Disputed, message: 'Reports conflict! Match is now disputed.' }
      }

      this.logger?.info(`Match ${matchId}: Report submitted, waiting for opponent`)
      return { status: MatchStatus.Reported, message: 'Report submitted. Waiting for opponent to report.' }
    })
  }

  /**
   * Extend the deadline for a match.
   */
  public async extendDeadline(
    matchId: number,
    hours: number,
    maxExtensionHours: number
  ): Promise<{ newDeadlineAt: number; addedMinutes: number }> {
    this.logger?.info(`Match ${matchId}: extendDeadline — hours=${hours}, maxExtensionHours=${maxExtensionHours}`)

    const match = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (match === undefined) {
      throw new Error('Match not found.')
    }
    if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
      throw new Error('Match is already completed.')
    }

    const newCumulative = match.deadlineExtensionMinutes + hours * 60
    const maxCumulative = maxExtensionHours * 60
    if (newCumulative > maxCumulative) {
      this.logger?.info(
        `Match ${matchId}: Extension rejected — cumulative ${newCumulative}m exceeds max ${maxCumulative}m`
      )
      throw new Error(`Max cumulative extension (${maxExtensionHours}h) reached for this match.`)
    }

    const addedMinutes = hours * 60
    await this.databaseManager.execute(
      `UPDATE "tournament_matches" SET "deadlineExtensionMinutes" = "deadlineExtensionMinutes" + $1, "manuallyExtended" = TRUE, "deadlineAt" = "deadlineAt" + $2 * 3600, "warningsSent" = 0 WHERE "id" = $3`,
      [addedMinutes, hours, matchId]
    )

    const newDeadlineAt = (match.deadlineAt ?? Math.floor(Date.now() / 1000)) + hours * 3600

    this.logger?.info(`Match ${matchId}: Deadline extended by ${addedMinutes}m, new deadline=${newDeadlineAt}`)
    return { newDeadlineAt, addedMinutes }
  }

  /**
   * Forfeit a match. The opponent receives the win.
   */
  public async forfeit(matchId: number, forfeitingPlayerId: number): Promise<{ status: MatchStatus; message: string }> {
    this.logger?.info(`Match ${matchId}: forfeit — forfeitingPlayerId=${forfeitingPlayerId}`)

    const match = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (match === undefined) {
      throw new Error('Match not found.')
    }
    if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
      throw new Error('Match is already completed.')
    }

    const tournament = await this.getTournament(match.tournamentId)
    if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
      throw new Error('Tournament is not active.')
    }

    if (match.player1Id !== forfeitingPlayerId && match.player2Id !== forfeitingPlayerId) {
      throw new Error('Forfeiting player is not a participant in this match.')
    }

    const winnerId = match.player1Id === forfeitingPlayerId ? match.player2Id! : match.player1Id!
    this.logger?.info(`Match ${matchId}: Forfeit accepted, winner=${winnerId}`)
    await this.resolveWinner(matchId, winnerId)
    return { status: MatchStatus.Completed, message: 'Forfeit accepted.' }
  }

  /**
   * Admin forces winner for a disputed match.
   */
  public async adminConfirm(matchId: number, winnerId: number): Promise<void> {
    this.logger?.info(`Match ${matchId}: adminConfirm — winnerId=${winnerId}`)

    const match = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (match === undefined) {
      throw new Error('Match not found.')
    }
    if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
      this.logger?.info(`Match ${matchId}: Admin confirm rejected — match already ${match.status}`)
      throw new Error('Match is already completed.')
    }

    this.logger?.info(`Match ${matchId}: Admin confirmed winner ${winnerId}`)
    await this.resolveWinner(matchId, winnerId)
  }

  public async substitute(
    matchId: number,
    oldPlayerId: number,
    newPlayerUuid: string,
    newDiscordId: string
  ): Promise<{ success: boolean; message: string }> {
    this.logger?.info(
      `Match ${matchId}: substitute — oldPlayerId=${oldPlayerId}, newPlayerUuid=${newPlayerUuid}, newDiscordId=${newDiscordId}`
    )

    return await this.databaseManager.transaction(async (txClient) => {
      const matchResult = await txClient.query<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 FOR UPDATE',
        [matchId]
      )
      const match = matchResult.rows[0]
      if (!match) return { success: false, message: 'Match not found.' }

      const isPlayer1 = match.player1Id === oldPlayerId
      if (!isPlayer1 && match.player2Id !== oldPlayerId) {
        return { success: false, message: 'Old player is not a participant in this match.' }
      }
      const slotColumn = isPlayer1 ? '"player1Id"' : '"player2Id"'

      const tournament = await this.getTournament(match.tournamentId)
      if (!tournament) return { success: false, message: 'Tournament not found.' }

      // Look up or create new player record
      const existingResult = await txClient.query<TournamentPlayer>(
        'SELECT "id" FROM "tournament_players" WHERE "playerUuid" = $1 AND "tournamentId" = $2',
        [newPlayerUuid, match.tournamentId]
      )
      let newPlayerId: number
      if (existingResult.rows.length > 0) {
        newPlayerId = existingResult.rows[0].id
      } else {
        const insertResult = await txClient.query<TournamentPlayer>(
          `INSERT INTO "tournament_players" ("tournamentId", "playerUuid", "discordId", "seed", "status", "joinedAt")
           VALUES ($1, $2, $3, 9999, $4, $5) RETURNING "id"`,
          [match.tournamentId, newPlayerUuid, newDiscordId, PlayerStatus.Registered, Math.floor(Date.now() / 1000)]
        )
        newPlayerId = insertResult.rows[0].id
      }

      // Clear existing reports
      await txClient.query('DELETE FROM "tournament_reports" WHERE "matchId" = $1', [matchId])

      // Reset match status if not already completed
      if (match.status !== MatchStatus.Completed && match.status !== MatchStatus.Bye) {
        await txClient.query(
          `UPDATE "tournament_matches" SET ${slotColumn} = $1, "status" = $2, "player1Wins" = NULL, "player2Wins" = NULL, "winnerId" = NULL WHERE "id" = $3`,
          [newPlayerId, MatchStatus.Pending, matchId]
        )
      }

      // Archive old thread
      if (match.discordThreadId !== undefined) {
        await this.channelManager.archiveMatchThread(match.discordThreadId, 'Player substituted')
      }

      // Create new match thread
      if (tournament.discordChannelId !== undefined) {
        const otherPlayerId = isPlayer1 ? match.player2Id! : match.player1Id!
        const otherResult = await txClient.query<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "id" = $1',
          [otherPlayerId]
        )
        const newPlayerResult = await txClient.query<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "id" = $1',
          [newPlayerId]
        )
        const otherPlayer = otherResult.rows[0]
        const newPlayer = newPlayerResult.rows[0]

        if (otherPlayer !== undefined && newPlayer !== undefined) {
          const names = await this.getPlayerNames(tournament.id)
          const p1 = isPlayer1 ? newPlayer : otherPlayer
          const p2 = isPlayer1 ? otherPlayer : newPlayer
          const p1Name = names.get(p1.id) ?? 'Player 1'
          const p2Name = names.get(p2.id) ?? 'Player 2'

          const threadId = await this.channelManager.createMatchThread(
            tournament.discordChannelId,
            match,
            p1,
            p2,
            p1Name,
            p2Name
          )

          if (threadId !== undefined) {
            await txClient.query('UPDATE "tournament_matches" SET "discordThreadId" = $1 WHERE "id" = $2', [
              threadId,
              matchId
            ])
          }
        }
      }

      this.logger?.info(`Substitution: player ${oldPlayerId} replaced by ${newPlayerUuid} in match ${matchId}`)

      return { success: true, message: 'Player substituted successfully.' }
    })
  }

  /**
   * Auto-resolves match when deadline expires.
   */
  public async handleDeadlineExpiry(matchId: number): Promise<void> {
    this.logger?.info(`Match ${matchId}: handleDeadlineExpiry called`)

    const match = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (match === undefined || match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
      this.logger?.info(`Match ${matchId}: Deadline expiry skipped — match is ${match?.status ?? 'not found'}`)
      return
    }

    const reports = await this.databaseManager.queryRows<TournamentReport>(
      'SELECT * FROM "tournament_reports" WHERE "matchId" = $1',
      [matchId]
    )

    let winnerId: number | undefined = undefined

    if (reports.length === 1) {
      // One player reported, they advance
      winnerId = reports[0].claimedWinnerId
      this.logger?.info(`Match ${matchId}: Deadline expiry — 1 report found, advancing reporter ${winnerId}`)
    } else {
      // None reported (or dispute expired) -> higher seed advances
      this.logger?.info(`Match ${matchId}: Deadline expiry — ${reports.length} reports, advancing by seed`)
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
        winnerId = p1.seed < p2.seed ? p1.id : p2.id
      } else if (p1 !== undefined) {
        winnerId = p1.id
      } else if (p2 !== undefined) {
        winnerId = p2.id
      }
    }

    if (winnerId === undefined) {
      this.logger?.info(`Match ${matchId}: Deadline expiry — could not determine winner`)
    } else {
      this.logger?.info(`Match ${matchId}: Deadline expiry resolved — winner=${winnerId}`)
      await this.resolveWinner(matchId, winnerId)
    }
  }

  /**
   * Internal routine to resolve match winner and advance them.
   */
  private async resolveWinner(matchId: number, winnerId: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000)

    this.logger?.info(`Match ${matchId}: resolveWinner — winnerId=${winnerId}`)

    const match = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (match === undefined) return

    const tournament = await this.getTournament(match.tournamentId)
    if (tournament === undefined) return

    this.logger?.info(
      `Tournament ${tournament.id}, Match ${matchId}: Resolving winner, round=${match.round}, matchIndex=${match.matchIndex}`
    )

    // 1. Mark match completed
    this.logger?.info(`Match ${matchId}: Marking as completed`)
    await this.databaseManager.execute(
      'UPDATE "tournament_matches" SET "status" = $1, "winnerId" = $2, "completedAt" = $3 WHERE "id" = $4',
      [MatchStatus.Completed, winnerId, now, matchId]
    )

    // 2. Update players statuses
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    if (loserId !== undefined) {
      this.logger?.info(`Tournament ${tournament.id}, Match ${matchId}: Eliminating player ${loserId}`)
      await this.databaseManager.execute('UPDATE "tournament_players" SET "status" = $1 WHERE "id" = $2', [
        PlayerStatus.Eliminated,
        loserId
      ])
    }

    // Live update notification
    if (match.status !== MatchStatus.Bye) {
      this.logger?.info(`Match ${matchId}: Sending live update notification`)
      const liveNames = await this.getPlayerNames(match.tournamentId)
      await this.notifications
        .announceLiveUpdate(tournament, match, winnerId, loserId, liveNames)
        .catch(() => undefined)
    }

    // 3. Close & Lock Discord Thread
    if (match.discordThreadId !== undefined) {
      this.logger?.info(`Match ${matchId}: Archiving thread ${match.discordThreadId}`)
      const names = await this.getPlayerNames(match.tournamentId)
      const winnerName = names.get(winnerId) ?? 'Winner'
      const loserName = loserId === undefined ? 'BYE' : (names.get(loserId) ?? 'Loser')
      await this.channelManager.archiveMatchThread(
        match.discordThreadId,
        `Winner: **${winnerName}** (defeated **${loserName}**)`
      )
    }

    // 4. Advance winner to next match if exists
    if (match.nextMatchId === undefined) {
      // No next match -> check whether ALL matches are complete (for round-robin and other non-elimination formats)
      const allMatches = await this.databaseManager.queryRows<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
        [tournament.id]
      )
      const allComplete = allMatches.every((m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye)

      if (allComplete) {
        this.logger?.info(`Tournament ${tournament.id}: All matches complete! Crowning champion player ${winnerId}`)
        // All matches finished -> Tournament complete!
        await this.databaseManager.execute(
          'UPDATE "tournaments" SET "status" = $1, "winnerId" = $2, "completedAt" = $3 WHERE "id" = $4',
          [TournamentStatus.Completed, winnerId, now, tournament.id]
        )
        await this.databaseManager.execute('UPDATE "tournament_players" SET "status" = $1 WHERE "id" = $2', [
          PlayerStatus.Winner,
          winnerId
        ])

        const names = await this.getPlayerNames(tournament.id)
        const winnerName = names.get(winnerId) ?? 'Winner'
        await this.notifications.announceWinner(tournament, winnerName)
      } else {
        this.logger?.info(
          `Tournament ${tournament.id}: Match ${matchId} resolved, no next match — waiting for other matches`
        )
      }
    } else {
      this.logger?.info(
        `Match ${matchId}: Advancing winner ${winnerId} to next match ${match.nextMatchId} (slot based on matchIndex=${match.matchIndex})`
      )
      const nextMatch = await this.databaseManager.queryOne<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1',
        [match.nextMatchId]
      )

      if (nextMatch !== undefined) {
        let playerField = 'player1Id'
        // If matchIndex is odd, this winner goes to player2Id of the next match
        if (match.matchIndex % 2 === 1) {
          playerField = 'player2Id'
        }

        this.logger?.info(`Match ${matchId}: Placing winner into next match ${match.nextMatchId} field ${playerField}`)
        await this.databaseManager.execute(`UPDATE "tournament_matches" SET "${playerField}" = $1 WHERE "id" = $2`, [
          winnerId,
          match.nextMatchId
        ])

        // Refresh next match to check if it's now ready
        const updatedNextMatch = await this.databaseManager.queryOne<TournamentMatch>(
          'SELECT * FROM "tournament_matches" WHERE "id" = $1',
          [match.nextMatchId]
        )

        if (updatedNextMatch?.player1Id !== undefined && updatedNextMatch.player2Id !== undefined) {
          this.logger?.info(`Match ${match.nextMatchId}: Both players present! Activating match`)
          // Both players present! Activate match
          const deadlineAt = now + tournament.roundDeadlineHours * 3600
          await this.databaseManager.execute(
            'UPDATE "tournament_matches" SET "status" = $1, "deadlineAt" = $2 WHERE "id" = $3',
            [MatchStatus.Active, deadlineAt, updatedNextMatch.id]
          )

          // Spawn new thread
          const p1 = await this.databaseManager.queryOne<TournamentPlayer>(
            'SELECT * FROM "tournament_players" WHERE "id" = $1',
            [updatedNextMatch.player1Id]
          )
          const p2 = await this.databaseManager.queryOne<TournamentPlayer>(
            'SELECT * FROM "tournament_players" WHERE "id" = $1',
            [updatedNextMatch.player2Id]
          )

          if (p1 !== undefined && p2 !== undefined && tournament.discordChannelId !== undefined) {
            this.logger?.info(`Match ${updatedNextMatch.id}: Spawning new match thread`)
            const names = await this.getPlayerNames(tournament.id)
            const p1Name = names.get(p1.id) ?? 'Player 1'
            const p2Name = names.get(p2.id) ?? 'Player 2'

            const threadId = await this.channelManager.createMatchThread(
              tournament.discordChannelId,
              updatedNextMatch,
              p1,
              p2,
              p1Name,
              p2Name
            )

            if (threadId !== undefined) {
              this.logger?.info(`Match ${updatedNextMatch.id}: Thread created (threadId=${threadId})`)
              await this.databaseManager.execute(
                'UPDATE "tournament_matches" SET "discordThreadId" = $1 WHERE "id" = $2',
                [threadId, updatedNextMatch.id]
              )
              updatedNextMatch.discordThreadId = threadId
            }

            await this.notifications.notifyMatchStart(
              tournament.bridgeId,
              updatedNextMatch,
              p1.playerUuid,
              p2.playerUuid,
              p1Name,
              p2Name
            )
          }
        } else {
          this.logger?.info(
            `Match ${match.nextMatchId}: Waiting for second player (p1=${updatedNextMatch?.player1Id ?? 'none'}, p2=${updatedNextMatch?.player2Id ?? 'none'})`
          )
        }
      }
    }

    // 5. Update live bracket message
    this.logger?.info(`Tournament ${tournament.id}: Updating bracket embed after match ${matchId} resolution`)
    const allMatches = await this.databaseManager.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
      [tournament.id]
    )
    const allPlayers = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournament.id]
    )
    const names = await this.getPlayerNames(tournament.id)

    if (tournament.discordChannelId !== undefined && tournament.bracketMessageId !== undefined) {
      await this.channelManager.updateBracketEmbed(
        tournament.discordChannelId,
        tournament.bracketMessageId,
        tournament,
        allMatches,
        allPlayers,
        names
      )
    }

    // 6. Check if current round is complete
    const roundMatches = allMatches.filter((m) => m.round === tournament.currentRound)
    const allRoundCompleted = roundMatches.every(
      (m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye
    )

    if (allRoundCompleted && tournament.status === TournamentStatus.Active) {
      // Progress round
      const nextRound = tournament.currentRound + 1
      this.logger?.info(
        `Tournament ${tournament.id}: Round ${tournament.currentRound} complete! Progressing to round ${nextRound}`
      )
      await this.databaseManager.execute('UPDATE "tournaments" SET "currentRound" = $1 WHERE "id" = $2', [
        nextRound,
        tournament.id
      ])
      tournament.currentRound = nextRound

      await this.notifications.announceRoundComplete(tournament, nextRound - 1)

      // Update bracket display to reflect new round
      if (tournament.discordChannelId !== undefined && tournament.bracketMessageId !== undefined) {
        await this.channelManager.updateBracketEmbed(
          tournament.discordChannelId,
          tournament.bracketMessageId,
          tournament,
          allMatches,
          allPlayers,
          names
        )
      }
    }
  }
}
