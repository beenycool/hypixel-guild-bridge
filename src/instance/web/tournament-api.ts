import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'
import {
  MatchStatus,
  type Tournament,
  type TournamentMatch,
  type TournamentPlayer,
  TournamentStatus
} from '../../core/tournament/types.js'

import { sendError, sendSuccess } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

const TournamentPrefix = '/api/tournament'

export class TournamentApiHandler {
  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  private verifyAuth(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): { permission: Permission; userId?: string } | undefined {
    const webConfig = this.application.config.web
    if (!webConfig?.signingSecret) return undefined
    const authHeader = request.headers.authorization
    const tokens = buildTokenSet(webConfig)
    const result = verifyToken(tokens, authHeader)
    if (result.ok) return { permission: result.permission, userId: result.userId }
    sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
    return undefined
  }

  public async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart || (!pathPart.startsWith(TournamentPrefix + '/') && pathPart !== TournamentPrefix)) return false

    const method = request.method ?? 'GET'

    this.logger.info(`API ${method} ${pathPart}`)

    const auth = this.verifyAuth(request, response)
    if (auth === undefined) return true
    const permission = auth.permission

    if (permission < Permission.Helper) {
      this.logger.info(`API ${pathPart}: Forbidden — permission level ${permission}`)
      sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
      return true
    }

    if (pathPart === `${TournamentPrefix}/list`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleList(response)
      return true
    }

    // POST /api/tournament (create new tournament, no id in path)
    if (pathPart === TournamentPrefix || pathPart === TournamentPrefix + '/') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleCreate(request, response, auth)
      return true
    }

    const remaining = pathPart.slice(TournamentPrefix.length + 1)
    const segments = remaining.split('/')
    const tournamentId = Number(segments[0])

    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
      sendError(response, 'VALIDATION_ERROR', 'Invalid tournament ID', 400)
      return true
    }

    const subRoute = segments[1]

    if (!subRoute) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleGet(response, tournamentId)
      return true
    }

    if (subRoute === 'matches') {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleMatches(response, tournamentId)
      return true
    }

    if (subRoute === 'confirm') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleConfirm(request, response)
      return true
    }

    if (subRoute === 'substitute') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleSubstitute(request, response)
      return true
    }

    if (subRoute === 'audit') {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleAudit(response, tournamentId)
      return true
    }

    if (subRoute === 'start') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleStart(request, response, tournamentId)
      return true
    }

    if (subRoute === 'cancel') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleCancel(response, tournamentId)
      return true
    }

    if (subRoute === 'forfeit') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleForfeit(request, response)
      return true
    }

    if (subRoute === 'extend') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleExtend(request, response)
      return true
    }

    if (subRoute === 'open-checkin') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleOpenCheckin(response, tournamentId)
      return true
    }

    if (subRoute === 'add-player') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleAddPlayer(request, response, tournamentId)
      return true
    }

    if (subRoute === 'remove-player') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleRemovePlayer(request, response, tournamentId)
      return true
    }

    if (subRoute === 'test') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      const testAction = segments[2]
      if (testAction === 'resolve-match') {
        await this.handleTestResolveMatch(request, response, tournamentId)
        return true
      }
      if (testAction === 'resolve-round') {
        await this.handleTestResolveRound(request, response, tournamentId)
        return true
      }
      sendError(response, 'NOT_FOUND', 'Unknown test action. Use resolve-match or resolve-round.', 404)
      return true
    }

    sendError(response, 'NOT_FOUND', 'Not found', 404)
    return true
  }

  private async handleList(response: http.ServerResponse): Promise<void> {
    try {
      const rows = await this.application.core.databaseManager.queryRows<Tournament>(
        'SELECT * FROM "tournaments" ORDER BY "createdAt" DESC'
      )
      sendSuccess(response, rows)
    } catch (error: unknown) {
      this.logger.error('Failed to list tournaments:', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to list tournaments', 500)
    }
  }

  private async handleGet(response: http.ServerResponse, tournamentId: number): Promise<void> {
    try {
      const tournament = await this.application.core.tournamentManager.getTournament(tournamentId)
      if (tournament === undefined) {
        sendError(response, 'NOT_FOUND', 'Tournament not found', 404)
        return
      }

      const [matches, players] = await Promise.all([
        this.application.core.databaseManager.queryRows<TournamentMatch>(
          'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 ORDER BY "round", "matchIndex"',
          [tournamentId]
        ),
        this.application.core.databaseManager.queryRows<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
          [tournamentId]
        )
      ])

      sendSuccess(response, { tournament, matches, players })
    } catch (error: unknown) {
      this.logger.error('Failed to get tournament:', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to get tournament', 500)
    }
  }

  private async handleMatches(response: http.ServerResponse, tournamentId: number): Promise<void> {
    try {
      const matches = await this.application.core.databaseManager.queryRows<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 ORDER BY "round", "matchIndex"',
        [tournamentId]
      )
      sendSuccess(response, matches)
    } catch (error: unknown) {
      this.logger.error('Failed to get matches:', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to get matches', 500)
    }
  }

  private async handleConfirm(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const matchId = body.matchId
    const winnerId = body.winnerId
    if (typeof matchId !== 'number' || typeof winnerId !== 'number') {
      sendError(response, 'VALIDATION_ERROR', 'matchId and winnerId are required', 400)
      return
    }

    try {
      await this.application.core.tournamentManager.matchManager.adminConfirm(matchId, winnerId)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to confirm match:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleSubstitute(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const matchId = body.matchId
    const oldPlayerId = body.oldPlayerId
    const newPlayerUuid = body.newPlayerUuid
    const newDiscordId = body.newDiscordId

    if (typeof matchId !== 'number' || typeof oldPlayerId !== 'number' || typeof newPlayerUuid !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'matchId, oldPlayerId, and newPlayerUuid are required', 400)
      return
    }

    try {
      const result = await this.application.core.tournamentManager.matchManager.substitute(
        matchId,
        oldPlayerId,
        newPlayerUuid,
        newDiscordId as string
      )
      sendSuccess(response, result)
    } catch (error: unknown) {
      this.logger.error('Failed to substitute player:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleAudit(response: http.ServerResponse, tournamentId: number): Promise<void> {
    try {
      const logs = await this.application.core.databaseManager.queryRows(
        'SELECT * FROM "tournament_audit_log" WHERE "tournamentId" = $1 ORDER BY "createdAt" DESC LIMIT 100',
        [tournamentId]
      )
      sendSuccess(response, logs)
    } catch (error: unknown) {
      this.logger.error('Failed to get audit log:', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to get audit log', 500)
    }
  }

  private async handleCreate(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    auth: { permission: Permission; userId?: string }
  ): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const bridgeId = body.bridgeId
    const name = body.name
    const gameType = body.gameType
    const bestOf = body.bestOf
    const bracketFormat = body.bracketFormat
    const roundDeadlineHours = body.roundDeadlineHours
    const checkinWindowMinutes = body.checkinWindowMinutes
    const startedAtUnix = body.startedAtUnix

    if (typeof bridgeId !== 'string' || typeof name !== 'string' || typeof gameType !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'bridgeId, name, and gameType are required', 400)
      return
    }
    if (typeof bestOf !== 'number' || bestOf < 1) {
      sendError(response, 'VALIDATION_ERROR', 'bestOf must be a positive number', 400)
      return
    }

    const createdBy = auth.userId ?? 'web-ui'

    try {
      const tournament = await this.application.core.tournamentManager.createTournament(
        bridgeId,
        name,
        gameType,
        bestOf,
        createdBy,
        typeof roundDeadlineHours === 'number' ? roundDeadlineHours : 48,
        typeof startedAtUnix === 'number' ? startedAtUnix : undefined,
        typeof checkinWindowMinutes === 'number' ? checkinWindowMinutes : 60,
        typeof bracketFormat === 'string' ? bracketFormat : 'single-elim'
      )
      sendSuccess(response, tournament)
    } catch (error: unknown) {
      this.logger.error('Failed to create tournament:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleStart(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number
  ): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const guildId = body.guildId
    if (typeof guildId !== 'string') {
      const client = this.application.discordInstance.getClient()
      const guild = client.guilds.cache.first()
      if (guild === undefined) {
        sendError(response, 'VALIDATION_ERROR', 'guildId is required and no Discord guild available', 400)
        return
      }
      try {
        await this.application.core.tournamentManager.startTournament(tournamentId, guild.id)
        sendSuccess(response, { success: true })
        return
      } catch (error: unknown) {
        this.logger.error('Failed to start tournament:', error)
        sendError(response, 'INTERNAL_ERROR', String(error), 500)
        return
      }
    }

    try {
      await this.application.core.tournamentManager.startTournament(tournamentId, guildId)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to start tournament:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleCancel(response: http.ServerResponse, tournamentId: number): Promise<void> {
    try {
      await this.application.core.tournamentManager.cancelTournament(tournamentId)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to cancel tournament:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleForfeit(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const matchId = body.matchId
    const playerId = body.playerId
    if (typeof matchId !== 'number' || typeof playerId !== 'number') {
      sendError(response, 'VALIDATION_ERROR', 'matchId and playerId are required', 400)
      return
    }

    try {
      const result = await this.application.core.tournamentManager.matchManager.forfeit(matchId, playerId)
      sendSuccess(response, result)
    } catch (error: unknown) {
      this.logger.error('Failed to forfeit match:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleExtend(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const matchId = body.matchId
    const hours = body.hours
    if (typeof matchId !== 'number' || typeof hours !== 'number' || hours < 1) {
      sendError(response, 'VALIDATION_ERROR', 'matchId and hours are required', 400)
      return
    }

    try {
      const bridgeId = body.bridgeId
      const maxExtensionHours =
        typeof bridgeId === 'string'
          ? this.application.core.bridgeConfigurations.getTournamentMaxExtensionHours(bridgeId)
          : 48
      const result = await this.application.core.tournamentManager.matchManager.extendDeadline(
        matchId,
        hours,
        maxExtensionHours
      )
      sendSuccess(response, result)
    } catch (error: unknown) {
      this.logger.error('Failed to extend deadline:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleOpenCheckin(response: http.ServerResponse, tournamentId: number): Promise<void> {
    try {
      await this.application.core.tournamentManager.openCheckinManually(tournamentId)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to open check-in:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleAddPlayer(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number
  ): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const playerUuid = body.playerUuid
    const discordId = body.discordId

    if (typeof playerUuid !== 'string' || playerUuid.trim().length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'playerUuid is required', 400)
      return
    }

    try {
      const player = await this.application.core.tournamentManager.addPlayer(
        tournamentId,
        playerUuid.trim(),
        typeof discordId === 'string' && discordId.trim().length > 0 ? discordId.trim() : undefined
      )
      sendSuccess(response, player)
    } catch (error: unknown) {
      this.logger.error('Failed to add player:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleRemovePlayer(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number
  ): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const playerUuid = body.playerUuid
    if (typeof playerUuid !== 'string' || playerUuid.trim().length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'playerUuid is required', 400)
      return
    }

    try {
      await this.application.core.tournamentManager.removePlayer(tournamentId, playerUuid.trim())
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to remove player:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleTestResolveMatch(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number
  ): Promise<void> {
    try {
      const result = await this.resolveTestMatches(tournamentId, 1)
      sendSuccess(response, result)
    } catch (error: unknown) {
      this.logger.error('Failed to resolve test match:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleTestResolveRound(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number
  ): Promise<void> {
    try {
      const result = await this.resolveTestMatches(tournamentId, 0)
      sendSuccess(response, result)
    } catch (error: unknown) {
      this.logger.error('Failed to resolve test round:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async resolveTestMatches(
    tournamentId: number,
    limit: number
  ): Promise<{ resolved: number; matches: { id: number; winner: string }[] }> {
    const tournament = await this.application.core.tournamentManager.getTournament(tournamentId)
    if (tournament === undefined) throw new Error('Tournament not found.')
    if (tournament.status !== TournamentStatus.Active) throw new Error('Tournament is not active.')

    const database = this.application.core.databaseManager
    const mm = this.application.core.tournamentManager.matchManager

    const matchQuery =
      limit > 0
        ? 'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "round" = $2 AND "status" = $3 ORDER BY "matchIndex" ASC LIMIT $4'
        : 'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "round" = $2 AND "status" = $3 ORDER BY "matchIndex" ASC'

    const parameters: unknown[] =
      limit > 0
        ? [tournamentId, tournament.currentRound, MatchStatus.Active, limit]
        : [tournamentId, tournament.currentRound, MatchStatus.Active]

    const activeMatches = await database.queryRows<TournamentMatch>(matchQuery, parameters)
    if (activeMatches.length === 0) throw new Error(`No active matches in round ${tournament.currentRound}.`)

    const players = await database.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )

    const resolved: { id: number; winner: string }[] = []

    for (const match of activeMatches) {
      if (match.player1Id === undefined || match.player2Id === undefined) continue

      const player1 = players.find((p) => p.id === match.player1Id)
      const player2 = players.find((p) => p.id === match.player2Id)
      if (player1 === undefined || player2 === undefined) continue

      const winnerId = player1.seed < player2.seed ? player1.id : player2.id
      const winner = player1.seed < player2.seed ? player1.playerUuid : player2.playerUuid
      const winScore = Math.ceil(tournament.bestOf / 2)

      await mm.submitReport(match.id, match.player1Id, winnerId, winScore, 0).catch(() => undefined)
      await mm.submitReport(match.id, match.player2Id, winnerId, 0, winScore).catch(() => undefined)

      resolved.push({ id: match.id, winner: winner.slice(0, 8) })
    }

    return { resolved: resolved.length, matches: resolved }
  }

  private async readJsonBody(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<Record<string, unknown> | undefined> {
    let raw: string
    try {
      raw = await this.readBody(request)
    } catch {
      sendError(response, 'INTERNAL_ERROR', 'Failed to read request body', 400)
      return undefined
    }

    if (raw.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing request body', 400)
      return undefined
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      sendError(response, 'VALIDATION_ERROR', 'Invalid JSON body', 400)
      return undefined
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendError(response, 'VALIDATION_ERROR', 'Body must be a JSON object', 400)
      return undefined
    }

    return parsed as Record<string, unknown>
  }

  private readBody(request: http.IncomingMessage): Promise<string> {
    request.setEncoding('utf8')
    return new Promise((resolve, reject) => {
      let body = ''
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        resolve(body)
      })
      request.on('error', reject)
    })
  }

  private sendMethodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '))
    sendError(response, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405)
  }
}
