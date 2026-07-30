import { ChatCommandHandler } from '../../../common/commands.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { validateSeriesScore } from '../../../core/tournament/score-validator.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from '../../../core/tournament/types.js'
import type { TournamentMatch, TournamentPlayer } from '../../../core/tournament/types.js'

export default class Tournament extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['tournament', 'tour', 't'],
      description: 'Tournament commands — join, checkin, report, forfeit, bracket, status',
      example: 'tournament join'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const subcommand = context.args[0] ?? 'status'
    const bridgeId = context.message.bridgeId
    if (bridgeId === undefined) {
      return 'No bridge configured for this chat channel.'
    }

    context.app.logger.info(
      `MC !tournament ${subcommand} — user=${context.message.user.displayName()}, bridgeId=${bridgeId}`
    )

    const tournamentManager = context.app.core.tournamentManager
    const tournament = tournamentManager.getActiveTournament(bridgeId)
    if (tournament === undefined) {
      return 'There is no active tournament on this bridge.'
    }

    const playerUuid = context.message.user.mojangProfile()?.id
    if (playerUuid === undefined) {
      return 'Could not determine your UUID.'
    }

    switch (subcommand) {
      case 'join': {
        context.app.logger.info(`MC tournament join: tournament=${tournament.id}, player=${playerUuid}`)
        if (tournament.status !== TournamentStatus.Signup) {
          return 'Tournament signups are closed.'
        }
        try {
          await tournamentManager.addPlayer(tournament.id, playerUuid, undefined)
          return 'You have joined the tournament!'
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }

      case 'checkin': {
        context.app.logger.info(`MC tournament checkin: tournament=${tournament.id}, player=${playerUuid}`)
        if (tournament.status !== TournamentStatus.Signup) {
          return 'Tournament is not in signup phase.'
        }
        try {
          await tournamentManager.checkinPlayer(tournament.id, playerUuid, playerUuid)
          return 'You have checked in!'
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }

      case 'report': {
        context.app.logger.info(
          `MC tournament report: tournament=${tournament.id}, player=${playerUuid}, args=${context.args.slice(1).join(',')}`
        )
        if (tournament.status !== TournamentStatus.Active) {
          return 'Tournament is not active.'
        }
        const winnerChoice = context.args[1]
        const myWins = Number(context.args[2])
        const theirWins = Number(context.args[3])
        if (!winnerChoice || !['me', 'opponent'].includes(winnerChoice)) {
          return 'Usage: !tournament report <me|opponent> <myWins> <theirWins>'
        }
        if (!Number.isInteger(myWins) || !Number.isInteger(theirWins) || myWins < 0 || theirWins < 0) {
          return 'Scores must be non-negative integers.'
        }

        const validation = validateSeriesScore(tournament.bestOf, myWins, theirWins)
        if (!validation.valid) return validation.message

        const player = await context.app.core.databaseManager.queryOne<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
          [tournament.id, playerUuid]
        )
        if (player === undefined || player.status === PlayerStatus.Eliminated)
          return 'You are not active in this tournament.'

        const match = await context.app.core.databaseManager.queryOne<TournamentMatch>(
          `SELECT * FROM "tournament_matches"
           WHERE "tournamentId" = $1
             AND ("player1Id" = $2 OR "player2Id" = $2)
             AND "status" IN ($3, $4, $5)`,
          [tournament.id, player.id, MatchStatus.Active, MatchStatus.Reported, MatchStatus.Disputed]
        )
        if (match === undefined) return 'You have no active match to report.'

        let claimedWinnerId = player.id
        if (winnerChoice === 'opponent') {
          claimedWinnerId = (match.player1Id === player.id ? match.player2Id : match.player1Id) ?? player.id
        }
        const isPlayer1 = match.player1Id === player.id
        const p1Wins = isPlayer1 ? myWins : theirWins
        const p2Wins = isPlayer1 ? theirWins : myWins

        try {
          const result = await tournamentManager.matchManager.submitReport(
            match.id,
            player.id,
            claimedWinnerId,
            p1Wins,
            p2Wins
          )
          return result.message
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }

      case 'forfeit': {
        context.app.logger.info(`MC tournament forfeit: tournament=${tournament.id}, player=${playerUuid}`)
        if (tournament.status !== TournamentStatus.Active) return 'Tournament is not active.'
        const fPlayer = await context.app.core.databaseManager.queryOne<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
          [tournament.id, playerUuid]
        )
        if (fPlayer === undefined || fPlayer.status === PlayerStatus.Eliminated)
          return 'You are not active in this tournament.'

        const fMatch = await context.app.core.databaseManager.queryOne<TournamentMatch>(
          `SELECT * FROM "tournament_matches"
           WHERE "tournamentId" = $1
             AND ("player1Id" = $2 OR "player2Id" = $2)
             AND "status" IN ($3, $4, $5)`,
          [tournament.id, fPlayer.id, MatchStatus.Active, MatchStatus.Reported, MatchStatus.Disputed]
        )
        if (fMatch === undefined) return 'You have no active match to forfeit.'

        try {
          await tournamentManager.matchManager.forfeit(fMatch.id, fPlayer.id)
          return 'You have forfeited the match.'
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }

      case 'bracket': {
        context.app.logger.info(`MC tournament bracket: tournament=${tournament.id}`)
        if (tournament.discordChannelId !== undefined) {
          return `The bracket is available in the Discord channel: <#${tournament.discordChannelId}>`
        }
        return 'No bracket channel has been created yet.'
      }

      case 'status':
      default: {
        const players = await context.app.core.databaseManager.queryRows<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
          [tournament.id]
        )
        context.app.logger.info(
          `MC tournament status: tournament=${tournament.id}, player=${playerUuid} — ${players.length} registered`
        )
        return `Tournament: ${tournament.name} | Status: ${tournament.status} | Round: ${tournament.currentRound}/${tournament.totalRounds} | Players: ${players.length} | Best of: ${tournament.bestOf} | Game: ${tournament.gameType}`
      }
    }
  }
}
