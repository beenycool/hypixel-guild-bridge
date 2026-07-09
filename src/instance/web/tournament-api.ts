import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from '../../core/tournament/types.js'

import { sendError, sendSuccess } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

const TournamentPrefix = '/api/tournament'

export class TournamentApiHandler {
  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  private verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): Permission | undefined {
    const webConfig = this.application.config.web
    if (!webConfig?.signingSecret) return undefined
    const authHeader = request.headers.authorization
    const tokens = buildTokenSet(webConfig)
    const result = verifyToken(tokens, authHeader)
    if (result.ok) return result.permission
    sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
    return undefined
  }

  public async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart || (!pathPart.startsWith(TournamentPrefix + '/') && pathPart !== TournamentPrefix)) return false

    const method = request.method ?? 'GET'

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    if (permission < Permission.Helper) {
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
        newDiscordId as string | undefined
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
