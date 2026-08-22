import type { Logger } from 'log4js'

import type { DatabaseManager, Queryable } from '../../common/database-manager.js'

import type { AntiAbuse } from './anti-abuse.js'
import type { BracketGenerator } from './bracket-generator.js'
import { validateSeriesScore } from './score-validator.js'
import type { TournamentChannelManager } from './tournament-channel-manager.js'
import type { TournamentNotifications } from './tournament-notifications.js'
import type { Tournament, TournamentMatch, TournamentPlayer, TournamentReport } from './types.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from './types.js'

// Discord/announcement side effects are collected during a transaction and only
// executed after it commits, so a Discord API failure can never roll back
// already-decided match state.
type PostCommitAction = () => Promise<void>

export class MatchManager {
  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly channelManager: TournamentChannelManager,
    private readonly notifications: TournamentNotifications,
    private readonly getTournament: (id: number) => Promise<Tournament | undefined>,
    private readonly getPlayerNames: (tournamentId: number) => Promise<Map<number, string>>,
    private readonly checkProofAttachment?: (threadId: string) => Promise<boolean>,
    private readonly antiAbuse?: AntiAbuse,
    private readonly emitEvent?: (type: string, data: unknown) => void,
    private readonly notifyTournamentCompleted?: (tournamentId: number) => Promise<void>,
    private readonly bracketGenerator?: BracketGenerator,
    private readonly logger?: Logger,
    private readonly invalidatePlayerNames?: (tournamentId: number) => void
  ) {}

  public async submitReport(
    matchId: number,
    reporterPlayerId: number,
    claimedWinnerId: number,
    p1Wins: number,
    p2Wins: number
  ): Promise<{ status: MatchStatus; message: string }> {
    this.logger?.debug(
      `[Tournament] Match #${matchId}: report by P${reporterPlayerId} -> winner P${claimedWinnerId} (${p1Wins}-${p2Wins})`
    )

    let hasProof = false
    const preMatch = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (preMatch?.discordThreadId !== undefined && this.checkProofAttachment !== undefined) {
      hasProof = await this.checkProofAttachment(preMatch.discordThreadId)
      this.logger?.debug(`[Tournament] Match #${matchId}: proof attachment check -> ${hasProof}`)
    }

    const postCommit: PostCommitAction[] = []
    const result = await this.databaseManager.transaction(async (txClient) => {
      const matchResult = await txClient.query<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 FOR UPDATE',
        [matchId]
      )
      const match = matchResult.rows[0] as TournamentMatch | undefined
      if (!match) {
        throw new Error('Match not found.')
      }
      if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
        this.logger?.debug(`[Tournament] Match #${matchId}: report ignored (already ${match.status})`)
        return { status: match.status, message: 'This match is already completed.' }
      }
      if (match.status === MatchStatus.Disputed) {
        this.logger?.debug(`[Tournament] Match #${matchId}: report ignored (disputed)`)
        return { status: MatchStatus.Disputed, message: 'This match is under dispute. Please wait for an admin.' }
      }

      if (match.player1Id !== reporterPlayerId && match.player2Id !== reporterPlayerId) {
        throw new Error('You are not a participant in this match.')
      }

      const tournament = await this.getTournament(match.tournamentId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
        throw new Error('Tournament is not active.')
      }

      const scoreCheck = validateSeriesScore(tournament.bestOf, p1Wins, p2Wins)
      if (!scoreCheck.valid) {
        this.logger?.debug(`[Tournament] Match #${matchId}: invalid score (${scoreCheck.message})`)
        return { status: match.status, message: scoreCheck.message }
      }

      const winnerIsParticipant = match.player1Id === claimedWinnerId || match.player2Id === claimedWinnerId
      if (!winnerIsParticipant) {
        this.logger?.debug(`[Tournament] Match #${matchId}: claimed winner is not a participant`)
        return { status: match.status, message: 'Claimed winner is not a participant in this match.' }
      }
      const winnerByScore = p1Wins > p2Wins ? match.player1Id : match.player2Id
      if (winnerByScore === undefined || winnerByScore !== claimedWinnerId) {
        this.logger?.debug(
          `[Tournament] Match #${matchId}: claimed winner does not match reported score (${p1Wins}-${p2Wins})`
        )
        return { status: match.status, message: 'Reported winner does not match the reported score.' }
      }

      this.logger?.debug(`[Tournament] Match #${matchId}: saving report for P${reporterPlayerId}`)
      await txClient.query(
        `INSERT INTO "tournament_reports" ("matchId", "reporterId", "claimedWinnerId", "player1Wins", "player2Wins")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("matchId", "reporterId") DO UPDATE SET
           "claimedWinnerId" = EXCLUDED."claimedWinnerId",
           "player1Wins" = EXCLUDED."player1Wins",
           "player2Wins" = EXCLUDED."player2Wins"`,
        [matchId, reporterPlayerId, claimedWinnerId, p1Wins, p2Wins]
      )

      if (hasProof) {
        await txClient.query('UPDATE "tournament_matches" SET "hadProofAttachment" = 1 WHERE "id" = $1', [matchId])
      }

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

      this.logger?.debug(
        `[Tournament] Match #${matchId}: ${reports.length}/${expectedReportCount} reports -> ${newStatus}`
      )

      await txClient.query('UPDATE "tournament_matches" SET "status" = $1 WHERE "id" = $2', [newStatus, matchId])
      match.status = newStatus

      if (newStatus === MatchStatus.BothConfirmed) {
        this.logger?.info(`[Tournament] Match #${matchId}: both reports match! Winner is P${claimedWinnerId}`)
        postCommit.push(...(await this.resolveWinner(matchId, claimedWinnerId, txClient, p1Wins, p2Wins)))
        return { status: MatchStatus.Completed, message: 'Match successfully resolved!' }
      } else if (newStatus === MatchStatus.Disputed) {
        this.logger?.info(`[Tournament] Match #${matchId}: conflicting reports! Match marked as disputed`)
        const disputeReports = reports
        postCommit.push(async () => {
          const names = await this.getPlayerNames(match.tournamentId)
          const p1Name = match.player1Id === undefined ? 'Player 1' : (names.get(match.player1Id) ?? 'Player 1')
          const p2Name = match.player2Id === undefined ? 'Player 2' : (names.get(match.player2Id) ?? 'Player 2')
          const r1Claimed = names.get(disputeReports[0].claimedWinnerId) ?? 'Unknown'
          const r2Claimed = names.get(disputeReports[1].claimedWinnerId) ?? 'Unknown'
          await this.notifications.notifyDispute(tournament.bridgeId, match, p1Name, p2Name, r1Claimed, r2Claimed)
        })
        return { status: MatchStatus.Disputed, message: 'Reports conflict! Match is now disputed.' }
      }

      this.logger?.debug(`[Tournament] Match #${matchId}: waiting for opponent report`)
      return { status: MatchStatus.Reported, message: 'Report submitted. Waiting for opponent to report.' }
    })

    await this.runPostCommit(`match ${matchId} report`, postCommit)
    return result
  }

  public async extendDeadline(
    matchId: number,
    hours: number,
    maxExtensionHours: number
  ): Promise<{ newDeadlineAt: number; addedMinutes: number }> {
    this.logger?.info(`[Tournament] Match #${matchId}: extending deadline +${hours}h (max: ${maxExtensionHours}h)`)

    return await this.databaseManager.transaction(async (txClient) => {
      const matchResult = await txClient.query<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 FOR UPDATE',
        [matchId]
      )
      const match = matchResult.rows[0] as TournamentMatch | undefined
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
      const now = Math.floor(Date.now() / 1000)
      await txClient.query(
        `UPDATE "tournament_matches" SET "deadlineExtensionMinutes" = "deadlineExtensionMinutes" + $1, "manuallyExtended" = TRUE, "deadlineAt" = COALESCE("deadlineAt", $2) + $3 * 3600, "warningsSent" = 0 WHERE "id" = $4`,
        [addedMinutes, now, hours, matchId]
      )

      const newDeadlineAt = (match.deadlineAt ?? now) + hours * 3600

      this.logger?.info(`Match ${matchId}: Deadline extended by ${addedMinutes}m, new deadline=${newDeadlineAt}`)
      return { newDeadlineAt, addedMinutes }
    })
  }

  public async forfeit(matchId: number, forfeitingPlayerId: number): Promise<{ status: MatchStatus; message: string }> {
    this.logger?.info(`Match ${matchId}: forfeit — forfeitingPlayerId=${forfeitingPlayerId}`)

    const postCommit: PostCommitAction[] = []
    const result = await this.databaseManager.transaction(async (txClient) => {
      const matchResult = await txClient.query<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 FOR UPDATE',
        [matchId]
      )
      const match = matchResult.rows[0] as TournamentMatch | undefined
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

      let forfeiterUuid: string | undefined
      let opponentUuid: string | undefined
      if (this.antiAbuse !== undefined) {
        const forfeitingPlayer = await this.databaseManager.queryOne<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "id" = $1',
          [forfeitingPlayerId],
          txClient
        )
        const opponentId = match.player1Id === forfeitingPlayerId ? match.player2Id : match.player1Id
        const opponent =
          opponentId === undefined
            ? undefined
            : await this.databaseManager.queryOne<TournamentPlayer>(
                'SELECT * FROM "tournament_players" WHERE "id" = $1',
                [opponentId],
                txClient
              )

        if (forfeitingPlayer !== undefined && opponent !== undefined) {
          const check = await this.antiAbuse.checkForfeitPattern(forfeitingPlayer.playerUuid, opponent.playerUuid)
          if (!check.allowed) {
            throw new Error(check.reason ?? 'FLAGGED: Suspicious forfeit pattern')
          }
          forfeiterUuid = forfeitingPlayer.playerUuid
          opponentUuid = opponent.playerUuid
        }
      }

      const winnerId = match.player1Id === forfeitingPlayerId ? match.player2Id : match.player1Id
      if (winnerId === undefined) {
        throw new Error('Cannot forfeit: opponent not found.')
      }
      this.logger?.info(`Match ${matchId}: Forfeit accepted, winner=${winnerId}`)
      const target = Math.ceil(tournament.bestOf / 2)
      const winnerIsPlayer1 = match.player1Id === winnerId
      postCommit.push(
        ...(await this.resolveWinner(
          matchId,
          winnerId,
          txClient,
          winnerIsPlayer1 ? target : 0,
          winnerIsPlayer1 ? 0 : target
        ))
      )

      if (this.antiAbuse !== undefined && forfeiterUuid !== undefined && opponentUuid !== undefined) {
        this.antiAbuse.recordForfeit(forfeiterUuid, opponentUuid)
      }
      return { status: MatchStatus.Completed, message: 'Forfeit accepted.' }
    })

    await this.runPostCommit(`match ${matchId} forfeit`, postCommit)
    return result
  }

  public async adminConfirm(
    matchId: number,
    winnerId: number,
    actorDiscordId?: string,
    p1Wins?: number,
    p2Wins?: number
  ): Promise<void> {
    this.logger?.info(
      `Match ${matchId}: adminConfirm — winnerId=${winnerId}, p1Wins=${p1Wins ?? 'default'}, p2Wins=${p2Wins ?? 'default'}`
    )

    const postCommit: PostCommitAction[] = []
    await this.databaseManager.transaction(async (txClient) => {
      const matchResult = await txClient.query<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 FOR UPDATE',
        [matchId]
      )
      const match = matchResult.rows[0] as TournamentMatch | undefined
      if (match === undefined) {
        throw new Error('Match not found.')
      }
      if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
        this.logger?.info(`Match ${matchId}: Admin confirm rejected — match already ${match.status}`)
        throw new Error('Match is already completed.')
      }

      const tournament = await this.getTournament(match.tournamentId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
        throw new Error('Tournament is not active.')
      }

      if (match.player1Id !== winnerId && match.player2Id !== winnerId) {
        throw new Error('Selected winner is not a participant in this match.')
      }

      let score1 = p1Wins
      let score2 = p2Wins
      if (score1 === undefined && score2 === undefined) {
        const target = Math.ceil(tournament.bestOf / 2)
        const winnerIsPlayer1 = match.player1Id === winnerId
        score1 = winnerIsPlayer1 ? target : 0
        score2 = winnerIsPlayer1 ? 0 : target
      } else {
        score1 = score1 ?? 0
        score2 = score2 ?? 0
      }
      const scoreCheck = validateSeriesScore(tournament.bestOf, score1, score2)
      if (!scoreCheck.valid) {
        this.logger?.info(`Match ${matchId}: Admin confirm score validation failed — ${scoreCheck.message}`)
        throw new Error(scoreCheck.message)
      }

      const winnerByScore = score1 > score2 ? match.player1Id : match.player2Id
      if (winnerByScore !== undefined && winnerByScore !== winnerId) {
        throw new Error('Selected winner does not match the provided score.')
      }

      if (this.antiAbuse !== undefined && actorDiscordId !== undefined) {
        const check = await this.antiAbuse.checkFalseReporting(actorDiscordId)
        if (!check.allowed) {
          throw new Error(check.reason ?? 'FLAGGED: High admin override rate')
        }
      }

      this.logger?.info(`Match ${matchId}: Admin confirmed winner ${winnerId} (${score1}-${score2})`)
      postCommit.push(...(await this.resolveWinner(matchId, winnerId, txClient, score1, score2)))

      if (this.antiAbuse !== undefined && actorDiscordId !== undefined) {
        this.antiAbuse.recordAdminOverride(actorDiscordId)
      }
    })

    await this.runPostCommit(`match ${matchId} admin confirm`, postCommit)
  }

  public async resolveByeMatch(matchId: number, winnerId: number): Promise<void> {
    this.logger?.info(`Match ${matchId}: resolveByeMatch — winnerId=${winnerId}`)

    const match = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (match === undefined) {
      throw new Error('Match not found.')
    }
    if (match.status !== MatchStatus.Bye) {
      throw new Error('Match is not a BYE match.')
    }

    const postCommit = await this.resolveWinner(matchId, winnerId)
    await this.runPostCommit(`match ${matchId} bye resolve`, postCommit)
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

    const postCommit: PostCommitAction[] = []
    const result = await this.databaseManager.transaction(async (txClient) => {
      const matchResult = await txClient.query<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 FOR UPDATE',
        [matchId]
      )
      const match = matchResult.rows[0] as TournamentMatch | undefined
      if (!match) return { success: false, message: 'Match not found.' }
      if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
        return { success: false, message: 'Match is already completed. Rewind it before substituting.' }
      }

      const isPlayer1 = match.player1Id === oldPlayerId
      if (!isPlayer1 && match.player2Id !== oldPlayerId) {
        return { success: false, message: 'Old player is not a participant in this match.' }
      }
      const slotColumn = isPlayer1 ? '"player1Id"' : '"player2Id"'

      const tournament = await this.getTournament(match.tournamentId)
      if (!tournament) return { success: false, message: 'Tournament not found.' }

      const oldPlayer = await this.databaseManager.queryOne<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "id" = $1',
        [oldPlayerId],
        txClient
      )
      if (oldPlayer === undefined) {
        return { success: false, message: 'Old player not found in this tournament.' }
      }

      const existingResult = await txClient.query<TournamentPlayer>(
        'SELECT "id", "status" FROM "tournament_players" WHERE "playerUuid" = $1 AND "tournamentId" = $2',
        [newPlayerUuid, match.tournamentId]
      )
      let newPlayerId: number
      const existingRow = existingResult.rows[0] as { id: number; status: PlayerStatus } | undefined
      if (existingRow === undefined) {
        const insertResult = await txClient.query<TournamentPlayer>(
          `INSERT INTO "tournament_players" ("tournamentId", "playerUuid", "discordId", "seed", "status", "joinedAt")
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING "id"`,
          [
            match.tournamentId,
            newPlayerUuid,
            newDiscordId,
            oldPlayer.seed,
            PlayerStatus.Registered,
            Math.floor(Date.now() / 1000)
          ]
        )
        newPlayerId = insertResult.rows[0].id
      } else {
        if (existingRow.status === PlayerStatus.Active || existingRow.status === PlayerStatus.Winner) {
          return {
            success: false,
            message: 'Replacement player is still active in the tournament bracket and cannot be substituted in.'
          }
        }
        newPlayerId = existingRow.id
        await txClient.query('UPDATE "tournament_players" SET "seed" = $1 WHERE "id" = $2', [
          oldPlayer.seed,
          newPlayerId
        ])
      }
      this.invalidatePlayerNames?.(match.tournamentId)

      await txClient.query('DELETE FROM "tournament_reports" WHERE "matchId" = $1', [matchId])

      const oldThreadId = match.discordThreadId
      const otherPlayerId = isPlayer1 ? match.player2Id : match.player1Id
      const bothPresent = otherPlayerId !== undefined
      const now = Math.floor(Date.now() / 1000)

      await txClient.query(
        `UPDATE "tournament_matches" SET ${slotColumn} = $1, "status" = $2, "player1Wins" = 0, "player2Wins" = 0, "winnerId" = NULL, "deadlineAt" = $3 WHERE "id" = $4`,
        [
          newPlayerId,
          bothPresent ? MatchStatus.Active : MatchStatus.Pending,
          bothPresent ? now + tournament.roundDeadlineHours * 3600 : undefined,
          matchId
        ]
      )

      if (oldThreadId !== undefined) {
        postCommit.push(async () => {
          await this.channelManager
            .archiveMatchThread(oldThreadId, 'Player substituted — thread superseded.')
            .catch(() => undefined)
        })
      }

      if (bothPresent && tournament.discordChannelId !== undefined) {
        const otherResult = await txClient.query<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "id" = $1',
          [otherPlayerId]
        )
        const newPlayerResult = await txClient.query<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "id" = $1',
          [newPlayerId]
        )
        const otherPlayer = otherResult.rows[0] as TournamentPlayer | undefined
        const newPlayer = newPlayerResult.rows[0] as TournamentPlayer | undefined

        if (otherPlayer !== undefined && newPlayer !== undefined) {
          const p1 = isPlayer1 ? newPlayer : otherPlayer
          const p2 = isPlayer1 ? otherPlayer : newPlayer
          const channelId = tournament.discordChannelId
          const bridgeId = tournament.bridgeId
          postCommit.push(async () => {
            const names = await this.getPlayerNames(tournament.id)
            const p1Name = names.get(p1.id) ?? 'Player 1'
            const p2Name = names.get(p2.id) ?? 'Player 2'

            const threadId = await this.channelManager.createMatchThread(channelId, match, p1, p2, p1Name, p2Name)

            if (threadId !== undefined) {
              await this.databaseManager.execute(
                'UPDATE "tournament_matches" SET "discordThreadId" = $1 WHERE "id" = $2',
                [threadId, matchId]
              )
              await this.notifications.notifyMatchReady(threadId, p1, p2, p1Name, p2Name)
            }

            await this.notifications.notifyMatchStart(bridgeId, match, p1.playerUuid, p2.playerUuid, p1Name, p2Name)
          })
        }
      }

      this.logger?.info(`Substitution: player ${oldPlayerId} replaced by ${newPlayerUuid} in match ${matchId}`)

      return { success: true, message: 'Player substituted successfully.' }
    })

    await this.runPostCommit(`match ${matchId} substitute`, postCommit)
    return result
  }

  public async handleDeadlineExpiry(matchId: number): Promise<void> {
    this.logger?.info(`Match ${matchId}: handleDeadlineExpiry called`)

    const postCommit: PostCommitAction[] = []
    await this.databaseManager.transaction(async (txClient) => {
      const matchResult = await txClient.query<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 FOR UPDATE',
        [matchId]
      )
      const match = matchResult.rows[0] as TournamentMatch | undefined
      if (match === undefined || match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
        this.logger?.info(`Match ${matchId}: Deadline expiry skipped — match is ${match?.status ?? 'not found'}`)
        return
      }

      const reportsResult = await txClient.query<TournamentReport>(
        'SELECT * FROM "tournament_reports" WHERE "matchId" = $1',
        [matchId]
      )
      const reports = reportsResult.rows

      let winnerId: number | undefined

      if (reports.length === 1) {
        const report = reports[0]
        const claimIsValid =
          (match.player1Id === report.claimedWinnerId && report.player1Wins > report.player2Wins) ||
          (match.player2Id === report.claimedWinnerId && report.player2Wins > report.player1Wins)
        if (claimIsValid) {
          winnerId = report.claimedWinnerId
          this.logger?.info(`Match ${matchId}: Deadline expiry — 1 valid report found, advancing reporter ${winnerId}`)
        } else {
          this.logger?.info(`Match ${matchId}: Deadline expiry — single report is invalid, falling back to seed`)
        }
      } else {
        this.logger?.info(`Match ${matchId}: Deadline expiry — ${reports.length} reports, advancing by seed`)
      }

      if (winnerId === undefined) {
        const p1 =
          match.player1Id === undefined
            ? undefined
            : await this.databaseManager.queryOne<TournamentPlayer>(
                'SELECT * FROM "tournament_players" WHERE "id" = $1',
                [match.player1Id],
                txClient
              )
        const p2 =
          match.player2Id === undefined
            ? undefined
            : await this.databaseManager.queryOne<TournamentPlayer>(
                'SELECT * FROM "tournament_players" WHERE "id" = $1',
                [match.player2Id],
                txClient
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
        return
      }

      this.logger?.info(`Match ${matchId}: Deadline expiry resolved — winner=${winnerId}`)
      postCommit.push(
        ...(await this.resolveWinner(
          matchId,
          winnerId,
          txClient,
          reports.length === 1 && reports[0].claimedWinnerId === winnerId ? reports[0].player1Wins : undefined,
          reports.length === 1 && reports[0].claimedWinnerId === winnerId ? reports[0].player2Wins : undefined
        ))
      )

      const tournament = await this.getTournament(match.tournamentId)
      const p1Uuid = await this.getPlayerUuid(match.player1Id, txClient)
      const p2Uuid = await this.getPlayerUuid(match.player2Id, txClient)
      const resolvedWinnerId = winnerId
      const message = '⚠️ Your match was auto-resolved after the deadline passed.'
      if (tournament !== undefined) {
        postCommit.push(async () => {
          const names = await this.getPlayerNames(match.tournamentId)
          const winnerName = names.get(resolvedWinnerId) ?? 'a player'
          const text = `${message} Winner: **${winnerName}**.`
          if (p1Uuid !== undefined && !p1Uuid.startsWith('00000000-0000-0000-0000-')) {
            await this.notifications.sendWhisper(tournament.bridgeId, p1Uuid, text).catch(() => undefined)
          }
          if (p2Uuid !== undefined && !p2Uuid.startsWith('00000000-0000-0000-0000-')) {
            await this.notifications.sendWhisper(tournament.bridgeId, p2Uuid, text).catch(() => undefined)
          }
        })
      }
    })

    await this.runPostCommit(`match ${matchId} deadline expiry`, postCommit)
  }

  private async runPostCommit(context: string, actions: PostCommitAction[]): Promise<void> {
    for (const action of actions) {
      try {
        await action()
      } catch (error: unknown) {
        this.logger?.error(`[Tournament] ${context}: post-commit side effect failed:`, error)
      }
    }
  }

  private async getPlayerUuid(playerId: number | undefined, database?: Queryable): Promise<string | undefined> {
    if (playerId === undefined) return undefined
    const player = await this.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "id" = $1',
      [playerId],
      database
    )
    return player?.playerUuid
  }

  private async resolveWinner(
    matchId: number,
    winnerId: number,
    database?: Queryable,
    p1Wins?: number,
    p2Wins?: number
  ): Promise<PostCommitAction[]> {
    const postCommit: PostCommitAction[] = []
    const now = Math.floor(Date.now() / 1000)

    this.logger?.debug(`Match ${matchId}: resolveWinner — winnerId=${winnerId}`)

    const match = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId],
      database
    )
    if (match === undefined) return postCommit

    const tournament = await this.getTournament(match.tournamentId)
    if (tournament === undefined) return postCommit

    this.logger?.debug(
      `Tournament ${tournament.id}, Match ${matchId}: Resolving winner, round=${match.round}, matchIndex=${match.matchIndex}`
    )

    this.logger?.debug(`Match ${matchId}: Marking as completed`)
    await this.databaseManager.execute(
      'UPDATE "tournament_matches" SET "status" = $1, "winnerId" = $2, "completedAt" = $3, "player1Wins" = COALESCE($4, "player1Wins"), "player2Wins" = COALESCE($5, "player2Wins") WHERE "id" = $6',
      [MatchStatus.Completed, winnerId, now, p1Wins ?? undefined, p2Wins ?? undefined, matchId],
      database
    )

    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    const strategy = this.bracketGenerator?.getStrategy(tournament.bracketFormat ?? 'single-elim')

    let bracketResetCreated = false
    if (
      loserId !== undefined &&
      match.loserNextMatchId === undefined &&
      strategy?.name === 'double-elim' &&
      match.matchIndex === 0 &&
      match.round === tournament.totalRounds
    ) {
      const ubFinal = await this.databaseManager.queryOne<{ winnerId: number | undefined }>(
        'SELECT "winnerId" FROM "tournament_matches" WHERE "nextMatchId" = $1 AND "loserNextMatchId" IS NOT NULL LIMIT 1',
        [matchId],
        database
      )
      if (ubFinal?.winnerId !== undefined && ubFinal.winnerId !== winnerId) {
        this.logger?.info(
          `Tournament ${tournament.id}: Grand final won by loser-bracket player ${winnerId} — creating bracket reset match`
        )
        bracketResetCreated = await this.createBracketResetMatch(
          match,
          winnerId,
          loserId,
          tournament,
          now,
          database,
          postCommit
        )
      }
    }

    if (loserId !== undefined && match.loserNextMatchId !== undefined) {
      this.logger?.debug(
        `Tournament ${tournament.id}, Match ${matchId}: Advancing loser ${loserId} to match ${match.loserNextMatchId}`
      )
      await this.placePlayerIntoNextMatch(
        loserId,
        match.loserNextMatchId,
        match.matchIndex,
        tournament,
        now,
        database,
        postCommit
      )
    } else if (loserId !== undefined && !bracketResetCreated && (strategy?.eliminatesLoser() ?? true)) {
      this.logger?.debug(`Tournament ${tournament.id}, Match ${matchId}: Eliminating player ${loserId}`)
      await this.databaseManager.execute(
        'UPDATE "tournament_players" SET "status" = $1 WHERE "id" = $2',
        [PlayerStatus.Eliminated, loserId],
        database
      )
    }

    if (match.status !== MatchStatus.Bye) {
      this.logger?.debug(`Match ${matchId}: Queueing live update notification`)
      const liveNames = await this.getPlayerNames(match.tournamentId)
      const isChampionMatch = match.nextMatchId === undefined && !bracketResetCreated
      const liveMatch = match
      postCommit.push(() =>
        this.notifications
          .announceLiveUpdate(tournament, liveMatch, winnerId, loserId, liveNames, isChampionMatch)
          .catch(() => undefined)
      )
    }

    if (match.discordThreadId !== undefined) {
      this.logger?.debug(`Match ${matchId}: Queueing thread archival ${match.discordThreadId}`)
      const archivedThreadId = match.discordThreadId
      const archiveNames = await this.getPlayerNames(match.tournamentId)
      const winnerName = archiveNames.get(winnerId) ?? 'Winner'
      const loserName = loserId === undefined ? 'BYE' : (archiveNames.get(loserId) ?? 'Loser')
      const scoreSuffix = p1Wins !== undefined && p2Wins !== undefined ? ` (${p1Wins}-${p2Wins})` : ''
      postCommit.push(() =>
        this.channelManager.archiveMatchThread(
          archivedThreadId,
          `Winner: **${winnerName}** (defeated **${loserName}**)${scoreSuffix}`
        )
      )
    }

    if (match.nextMatchId === undefined) {
      const allMatches = await this.databaseManager.queryRows<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
        [tournament.id],
        database
      )
      const allComplete = allMatches.every((m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye)

      if (allComplete) {
        const championId = strategy?.championId(allMatches) ?? winnerId
        this.logger?.info(`Tournament ${tournament.id}: All matches complete! Crowning champion player ${championId}`)

        await this.databaseManager.execute(
          'UPDATE "tournaments" SET "status" = $1, "winnerId" = $2, "completedAt" = $3 WHERE "id" = $4',
          [TournamentStatus.Completed, championId, now, tournament.id],
          database
        )
        await this.databaseManager.execute(
          'UPDATE "tournament_players" SET "status" = $1 WHERE "id" = $2',
          [PlayerStatus.Winner, championId],
          database
        )
        tournament.status = TournamentStatus.Completed
        tournament.winnerId = championId
        tournament.completedAt = now

        const completedTournamentId = tournament.id
        postCommit.push(async () => {
          const names = await this.getPlayerNames(completedTournamentId)
          const winnerName = names.get(championId) ?? 'Winner'
          await this.notifications.announceWinner(tournament, winnerName).catch((error: unknown) => {
            this.logger?.error(`Tournament ${completedTournamentId}: Failed to announce winner`, error)
          })

          if (this.notifyTournamentCompleted !== undefined) {
            await this.notifyTournamentCompleted(completedTournamentId).catch((error: unknown) => {
              this.logger?.error(`Tournament ${completedTournamentId}: Failed to finalize tournament completion`, error)
            })
          }
        })
      } else {
        this.logger?.debug(
          `Tournament ${tournament.id}: Match ${matchId} resolved, no next match — waiting for other matches`
        )
      }
    } else {
      this.logger?.debug(
        `Match ${matchId}: Advancing winner ${winnerId} to next match ${match.nextMatchId} (slot based on matchIndex=${match.matchIndex})`
      )
      await this.placePlayerIntoNextMatch(
        winnerId,
        match.nextMatchId,
        match.matchIndex,
        tournament,
        now,
        database,
        postCommit
      )
    }

    this.logger?.debug(`Tournament ${tournament.id}: Updating bracket embed after match ${matchId} resolution`)
    const allMatches = await this.databaseManager.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
      [tournament.id],
      database
    )
    const allPlayers = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournament.id],
      database
    )

    if (tournament.discordChannelId !== undefined && tournament.bracketMessageId !== undefined) {
      const embedChannelId = tournament.discordChannelId
      const currentBracketMessageId = tournament.bracketMessageId
      postCommit.push(async () => {
        const usedMessageId = await this.channelManager.updateBracketEmbed(
          embedChannelId,
          currentBracketMessageId,
          tournament,
          allMatches,
          allPlayers,
          await this.getPlayerNames(tournament.id)
        )
        if (usedMessageId !== undefined && usedMessageId !== tournament.bracketMessageId) {
          await this.databaseManager.execute('UPDATE "tournaments" SET "bracketMessageId" = $1 WHERE "id" = $2', [
            usedMessageId,
            tournament.id
          ])
          tournament.bracketMessageId = usedMessageId
        }
      })
    }

    const roundMatches = allMatches.filter((m) => m.round === tournament.currentRound)
    const allRoundCompleted = roundMatches.every(
      (m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye
    )

    if (allRoundCompleted && tournament.status === TournamentStatus.Active && (strategy?.progressesRounds() ?? true)) {
      const nextRound = tournament.currentRound + 1
      this.logger?.info(
        `Tournament ${tournament.id}: Round ${tournament.currentRound} complete! Progressing to round ${nextRound}`
      )
      await this.databaseManager.execute(
        'UPDATE "tournaments" SET "currentRound" = $1 WHERE "id" = $2',
        [nextRound, tournament.id],
        database
      )
      tournament.currentRound = nextRound

      const completedRound = nextRound - 1
      postCommit.push(async () => {
        await this.notifications.announceRoundComplete(tournament, completedRound).catch(() => undefined)
      })

      if (tournament.discordChannelId !== undefined && tournament.bracketMessageId !== undefined) {
        const embedChannelId = tournament.discordChannelId
        const currentBracketMessageId = tournament.bracketMessageId
        postCommit.push(async () => {
          const usedMessageId = await this.channelManager.updateBracketEmbed(
            embedChannelId,
            currentBracketMessageId,
            tournament,
            allMatches,
            allPlayers,
            await this.getPlayerNames(tournament.id)
          )
          if (usedMessageId !== undefined && usedMessageId !== tournament.bracketMessageId) {
            await this.databaseManager.execute('UPDATE "tournaments" SET "bracketMessageId" = $1 WHERE "id" = $2', [
              usedMessageId,
              tournament.id
            ])
            tournament.bracketMessageId = usedMessageId
          }
        })
      }
    }

    this.emitEvent?.('tournament.match_resolved', { tournamentId: tournament.id, matchId, winnerId })
    return postCommit
  }

  private async createBracketResetMatch(
    match: TournamentMatch,
    winnerId: number,
    loserId: number,
    tournament: Tournament,
    now: number,
    database?: Queryable,
    postCommit: PostCommitAction[] = []
  ): Promise<boolean> {
    const round = tournament.totalRounds + 1
    const deadlineAt = now + tournament.roundDeadlineHours * 3600

    const inserted = await this.databaseManager.queryOne<{ id: number }>(
      `INSERT INTO "tournament_matches" ("tournamentId", "round", "matchIndex", "player1Id", "player2Id", "status", "player1Wins", "player2Wins", "deadlineAt")
       VALUES ($1, $2, 0, $3, $4, $5, 0, 0, $6) RETURNING "id"`,
      [tournament.id, round, winnerId, loserId, MatchStatus.Active, deadlineAt],
      database
    )
    if (inserted === undefined) return false
    const resetId = inserted.id

    await this.databaseManager.execute(
      'UPDATE "tournaments" SET "totalRounds" = $1 WHERE "id" = $2',
      [round, tournament.id],
      database
    )
    tournament.totalRounds = round

    await this.databaseManager.execute(
      'UPDATE "tournament_players" SET "status" = $1 WHERE "id" = $2',
      [PlayerStatus.Active, loserId],
      database
    )

    const resetMatch: TournamentMatch = {
      ...match,
      id: resetId,
      round,
      matchIndex: 0,
      player1Id: winnerId,
      player2Id: loserId,
      winnerId: undefined,
      status: MatchStatus.Active,
      player1Wins: 0,
      player2Wins: 0,
      deadlineAt,
      completedAt: undefined,
      discordThreadId: undefined,
      nextMatchId: undefined,
      loserNextMatchId: undefined
    }

    if (tournament.discordChannelId !== undefined) {
      const p1 = await this.databaseManager.queryOne<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "id" = $1',
        [winnerId],
        database
      )
      const p2 = await this.databaseManager.queryOne<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "id" = $1',
        [loserId],
        database
      )
      if (p1 !== undefined && p2 !== undefined) {
        postCommit.push(async () => {
          const names = await this.getPlayerNames(tournament.id)
          const p1Name = names.get(p1.id) ?? 'Player 1'
          const p2Name = names.get(p2.id) ?? 'Player 2'

          if (tournament.discordChannelId !== undefined) {
            const threadId = await this.channelManager.createMatchThread(
              tournament.discordChannelId,
              resetMatch,
              p1,
              p2,
              p1Name,
              p2Name
            )

            if (threadId !== undefined) {
              await this.databaseManager.execute(
                'UPDATE "tournament_matches" SET "discordThreadId" = $1 WHERE "id" = $2',
                [threadId, resetId]
              )
              await this.notifications.notifyMatchReady(threadId, p1, p2, p1Name, p2Name)
            }
          }

          await this.notifications.notifyMatchStart(
            tournament.bridgeId,
            resetMatch,
            p1.playerUuid,
            p2.playerUuid,
            p1Name,
            p2Name
          )
        })
      }
    }

    this.logger?.info(
      `Tournament ${tournament.id}: Bracket reset match #${resetId} created (round ${round}) — ${winnerId} vs ${loserId}`
    )
    return true
  }

  private async placePlayerIntoNextMatch(
    playerId: number,
    nextMatchId: number,
    sourceMatchIndex: number,
    tournament: Tournament,
    now: number,
    database?: Queryable,
    postCommit: PostCommitAction[] = []
  ): Promise<void> {
    const nextMatch = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [nextMatchId],
      database
    )
    if (nextMatch === undefined) return

    let playerField = sourceMatchIndex % 2 === 1 ? 'player2Id' : 'player1Id'
    const parityOccupant = playerField === 'player1Id' ? nextMatch.player1Id : nextMatch.player2Id
    if (parityOccupant !== undefined && parityOccupant !== playerId) {
      const alternateField = playerField === 'player1Id' ? 'player2Id' : 'player1Id'
      const alternateOccupant = alternateField === 'player1Id' ? nextMatch.player1Id : nextMatch.player2Id
      if (alternateOccupant !== undefined && alternateOccupant !== playerId) {
        this.logger?.warn(`Match ${nextMatchId}: Both slots occupied — refusing to place player ${playerId}`)
        return
      }
      playerField = alternateField
    }

    this.logger?.debug(`Match ${nextMatchId}: Placing player ${playerId} into field ${playerField}`)
    await this.databaseManager.execute(
      `UPDATE "tournament_matches" SET "${playerField}" = $1 WHERE "id" = $2`,
      [playerId, nextMatchId],
      database
    )

    const updatedNextMatch = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [nextMatchId],
      database
    )

    if (updatedNextMatch?.player1Id !== undefined && updatedNextMatch.player2Id !== undefined) {
      this.logger?.info(`Match ${nextMatchId}: Both players present! Activating match`)

      const deadlineAt = now + tournament.roundDeadlineHours * 3600
      await this.databaseManager.execute(
        'UPDATE "tournament_matches" SET "status" = $1, "deadlineAt" = $2 WHERE "id" = $3',
        [MatchStatus.Active, deadlineAt, updatedNextMatch.id],
        database
      )

      const p1 = await this.databaseManager.queryOne<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "id" = $1',
        [updatedNextMatch.player1Id],
        database
      )
      const p2 = await this.databaseManager.queryOne<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "id" = $1',
        [updatedNextMatch.player2Id],
        database
      )

      if (p1 !== undefined && p2 !== undefined && tournament.discordChannelId !== undefined) {
        this.logger?.debug(`Match ${updatedNextMatch.id}: Queueing match thread spawn`)
        const channelId = tournament.discordChannelId
        const bridgeId = tournament.bridgeId
        postCommit.push(async () => {
          const names = await this.getPlayerNames(tournament.id)
          const p1Name = names.get(p1.id) ?? 'Player 1'
          const p2Name = names.get(p2.id) ?? 'Player 2'

          const threadId = await this.channelManager.createMatchThread(
            channelId,
            updatedNextMatch,
            p1,
            p2,
            p1Name,
            p2Name
          )

          if (threadId !== undefined) {
            this.logger?.debug(`Match ${updatedNextMatch.id}: Thread created (threadId=${threadId})`)
            await this.databaseManager.execute(
              'UPDATE "tournament_matches" SET "discordThreadId" = $1 WHERE "id" = $2',
              [threadId, updatedNextMatch.id]
            )
            updatedNextMatch.discordThreadId = threadId
            await this.notifications.notifyMatchReady(threadId, p1, p2, p1Name, p2Name)
          }

          await this.notifications.notifyMatchStart(
            bridgeId,
            updatedNextMatch,
            p1.playerUuid,
            p2.playerUuid,
            p1Name,
            p2Name
          )
        })
      }
    } else {
      this.logger?.debug(
        `Match ${nextMatchId}: Waiting for second player (p1=${updatedNextMatch?.player1Id ?? 'none'}, p2=${updatedNextMatch?.player2Id ?? 'none'})`
      )
    }
  }
}
