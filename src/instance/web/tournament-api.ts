import type http from 'node:http'

import { ChannelType } from 'discord.js'

import { Permission } from '../../common/application-event.js'
import {
  MatchStatus,
  PlayerStatus,
  type Tournament,
  type TournamentMatch,
  type TournamentPlayer,
  TournamentStatus
} from '../../core/tournament/types.js'
import {
  buildCheckinAnnouncementEmbed,
  buildCheckinComponents,
  buildSignupComponents,
  buildSignupEmbed,
  fetchParticipantCount
} from '../discord/features/tournament-buttons.js'

import { readJsonBody, sendError, sendSuccess } from './api-utils.js'
import { BaseApiHandler } from './base-api.js'

const TournamentPrefix = '/api/tournament'

const SupportedBracketFormats = new Set(['single-elim', 'double-elim', 'round-robin'])

interface TournamentResult {
  id: number
  playerUuid: string
  discordId: string | undefined
  tournamentId: number
  placement: number
  roundsReached: number
  wins: number
  losses: number
  champion: number
  createdAt: number
}

export class TournamentApiHandler extends BaseApiHandler {
  private readonly userProfileCache = new Map<string, { expiresAt: number; profile: unknown }>()

  public async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart || (!pathPart.startsWith(TournamentPrefix + '/') && pathPart !== TournamentPrefix)) return false

    const method = request.method ?? 'GET'

    this.logger.info(`API ${method} ${pathPart}`)

    const auth = this.verifyAuthWithUser(request, response)
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

    if (pathPart === `${TournamentPrefix}/active`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      this.handleActive(request, response)
      return true
    }

    if (pathPart === `${TournamentPrefix}/users`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleResolveUsers(request, response)
      return true
    }

    if (pathPart === `${TournamentPrefix}/categories`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleCategories(request, response)
      return true
    }

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

    if (pathPart === `${TournamentPrefix}/test/create`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleTestCreate(request, response, auth)
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

    if (subRoute === 'undo') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleUndo(request, response, tournamentId, auth)
      return true
    }

    if (subRoute === 'results') {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleResults(response, tournamentId)
      return true
    }

    if (subRoute === 'seeds') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleSeeds(request, response, tournamentId, auth)
      return true
    }

    if (subRoute === 'edit') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleEdit(request, response, tournamentId, auth)
      return true
    }

    if (subRoute === 'reopen') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleReopen(response, tournamentId, auth)
      return true
    }

    if (subRoute === 'bye') {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleAdvanceBye(request, response, tournamentId, auth)
      return true
    }

    if (subRoute === 'proof') {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      if (permission < Permission.Officer) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleProof(response, tournamentId, segments[2])
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

      const [matches, players, reports] = await Promise.all([
        this.application.core.databaseManager.queryRows<TournamentMatch>(
          'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 ORDER BY "round", "matchIndex"',
          [tournamentId]
        ),
        this.application.core.databaseManager.queryRows<TournamentPlayer>(
          'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
          [tournamentId]
        ),
        this.application.core.databaseManager.queryRows(
          'SELECT r.* FROM "tournament_reports" r JOIN "tournament_matches" m ON m."id" = r."matchId" WHERE m."tournamentId" = $1',
          [tournamentId]
        )
      ])

      sendSuccess(response, { tournament, matches, players, reports })
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
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
    if (body === undefined) return

    const matchId = body.matchId
    const winnerId = body.winnerId
    if (typeof matchId !== 'number' || typeof winnerId !== 'number') {
      sendError(response, 'VALIDATION_ERROR', 'matchId and winnerId are required', 400)
      return
    }
    const p1Wins = body.p1Wins
    const p2Wins = body.p2Wins
    if ((p1Wins !== undefined && typeof p1Wins !== 'number') || (p2Wins !== undefined && typeof p2Wins !== 'number')) {
      sendError(response, 'VALIDATION_ERROR', 'p1Wins and p2Wins must be numbers', 400)
      return
    }

    try {
      await this.application.core.tournamentManager.matchManager.adminConfirm(
        matchId,
        winnerId,
        undefined,
        p1Wins,
        p2Wins
      )
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to confirm match:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleSubstitute(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
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
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
    if (body === undefined) return

    const bridgeId = body.bridgeId
    const name = body.name
    const gameType = body.gameType

    if (typeof bridgeId !== 'string' || typeof name !== 'string' || typeof gameType !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'bridgeId, name, and gameType are required', 400)
      return
    }
    if (name.trim().length === 0 || gameType.trim().length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'name and gameType must not be empty', 400)
      return
    }

    const config = this.application.core.bridgeConfigurations

    const bestOf = typeof body.bestOf === 'number' ? body.bestOf : config.getTournamentDefaultBestOf(bridgeId)
    if (!Number.isInteger(bestOf) || bestOf < 1 || bestOf % 2 === 0) {
      sendError(response, 'VALIDATION_ERROR', 'bestOf must be a positive odd integer (e.g. 1, 3, 5)', 400)
      return
    }

    const roundDeadlineHours =
      typeof body.roundDeadlineHours === 'number'
        ? body.roundDeadlineHours
        : config.getTournamentDefaultDeadlineHours(bridgeId)
    if (!Number.isInteger(roundDeadlineHours) || roundDeadlineHours < 1 || roundDeadlineHours > 720) {
      sendError(response, 'VALIDATION_ERROR', 'roundDeadlineHours must be an integer between 1 and 720', 400)
      return
    }

    const checkinWindowMinutes =
      typeof body.checkinWindowMinutes === 'number'
        ? body.checkinWindowMinutes
        : config.getTournamentCheckinWindowMinutes(bridgeId)
    if (!Number.isInteger(checkinWindowMinutes) || checkinWindowMinutes < 0 || checkinWindowMinutes > 1440) {
      sendError(response, 'VALIDATION_ERROR', 'checkinWindowMinutes must be an integer between 0 and 1440', 400)
      return
    }

    const bracketFormat =
      typeof body.bracketFormat === 'string' ? body.bracketFormat : config.getTournamentDefaultBracketFormat(bridgeId)
    if (!SupportedBracketFormats.has(bracketFormat)) {
      sendError(
        response,
        'VALIDATION_ERROR',
        `Unsupported bracketFormat "${bracketFormat}". Use single-elim, double-elim, or round-robin.`,
        400
      )
      return
    }

    const categoryId = typeof body.categoryId === 'string' ? body.categoryId.trim() : ''
    config.setTournamentCategoryId(bridgeId, categoryId === '' ? undefined : categoryId)

    let startedAtUnix: number | undefined
    if (body.startedAtUnix !== undefined) {
      if (typeof body.startedAtUnix !== 'number' || !Number.isFinite(body.startedAtUnix)) {
        sendError(response, 'VALIDATION_ERROR', 'startedAtUnix must be a unix timestamp', 400)
        return
      }
      if (body.startedAtUnix < Math.floor(Date.now() / 1000) - 60) {
        sendError(response, 'VALIDATION_ERROR', 'startedAtUnix must be in the future', 400)
        return
      }
      startedAtUnix = body.startedAtUnix
    }

    const createdBy = auth.userId ?? 'web-ui'

    try {
      const tournament = await this.application.core.tournamentManager.createTournament(
        bridgeId,
        name,
        gameType,
        bestOf,
        createdBy,
        roundDeadlineHours,
        startedAtUnix,
        checkinWindowMinutes,
        bracketFormat
      )

      try {
        const notificationChannelId = config.getTournamentNotificationChannelId(bridgeId)
        if (notificationChannelId) {
          const client = this.application.discordInstance.getClient()
          const channel = await client.channels.fetch(notificationChannelId).catch(() => undefined)
          if (channel?.isTextBased() && 'send' in channel) {
            const participantCount = await fetchParticipantCount(this.application.core.databaseManager, tournament.id)
            const signupMessage = await channel
              .send({ embeds: [buildSignupEmbed(tournament, participantCount)] })
              .catch(() => undefined)
            if (signupMessage !== undefined) {
              await signupMessage
                .edit({ components: buildSignupComponents(tournament.id, signupMessage.id) })
                .catch(() => undefined)
            }
          }
        }
      } catch (error: unknown) {
        this.logger.warn(`Failed to post signup announcement for tournament ${tournament.id}`, error)
      }

      sendSuccess(response, tournament)
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('already exists')) {
        sendError(response, 'CONFLICT', error.message, 409)
        return
      }
      this.logger.error('Failed to create tournament:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private handleActive(request: http.IncomingMessage, response: http.ServerResponse): void {
    const rawUrl = request.url ?? ''
    const query = new URLSearchParams(rawUrl.split('?')[1] ?? '')
    const bridgeId = query.get('bridgeId')
    if (bridgeId === null || bridgeId.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'bridgeId query parameter is required', 400)
      return
    }

    try {
      const tournament = this.application.core.tournamentManager.getActiveTournament(bridgeId)
      sendSuccess(response, { tournament })
    } catch (error: unknown) {
      this.logger.error('Failed to get active tournament:', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to get active tournament', 500)
    }
  }

  private async handleResolveUsers(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const rawUrl = request.url ?? ''
    const query = new URLSearchParams(rawUrl.split('?')[1] ?? '')
    const idsRaw = query.get('ids') ?? ''
    const ids = idsRaw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)

    if (ids.length === 0) {
      sendSuccess(response, {})
      return
    }
    if (ids.length > 100) {
      sendError(response, 'VALIDATION_ERROR', 'Too many ids. Maximum of 100.', 400)
      return
    }

    const discordInstance = this.application.discordInstance
    const queryBridgeId = query.get('bridgeId')
    const bridgeGuild =
      queryBridgeId !== null && queryBridgeId.length > 0
        ? await this.application.core.tournamentManager.resolveGuildForBridge(queryBridgeId).catch(() => undefined)
        : undefined
    const guild = bridgeGuild ?? discordInstance.getClient().guilds.cache.first()
    const now = Date.now()
    const resolved: Record<string, unknown> = {}
    const pending: string[] = []

    for (const id of ids) {
      const cached = this.userProfileCache.get(id)
      if (cached !== undefined && cached.expiresAt > now) {
        resolved[id] = cached.profile
      } else {
        pending.push(id)
      }
    }

    for (const id of pending) {
      const profile = await discordInstance.profileById(id, guild).catch(() => undefined)
      if (profile === undefined) continue
      this.userProfileCache.set(id, { expiresAt: now + 10 * 60 * 1000, profile })
      resolved[id] = profile
    }

    this.logger.info(`Resolved ${Object.keys(resolved).length}/${ids.length} Discord user profile(s)`)
    sendSuccess(response, resolved)
  }

  private async handleCategories(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    try {
      const rawUrl = request.url ?? ''
      const query = new URLSearchParams(rawUrl.split('?')[1] ?? '')
      const bridgeId = query.get('bridgeId')
      const guild =
        bridgeId !== null && bridgeId.length > 0
          ? await this.application.core.tournamentManager.resolveGuildForBridge(bridgeId)
          : undefined
      if (guild === undefined) {
        sendSuccess(response, [])
        return
      }
      const categories = guild.channels.cache
        .filter((channel) => channel.type === ChannelType.GuildCategory)
        .map((channel) => ({ id: channel.id, name: channel.name }))
        .toSorted((a, b) => a.name.localeCompare(b.name))
      sendSuccess(response, categories)
    } catch (error: unknown) {
      this.logger.warn('Failed to fetch Discord categories:', error)
      sendSuccess(response, [])
    }
  }

  private async handleStart(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number
  ): Promise<void> {
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
    if (body === undefined) return

    const guildId = typeof body.guildId === 'string' ? body.guildId : undefined
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
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
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
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
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

  private async handleUndo(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number,
    auth: { permission: Permission; userId?: string }
  ): Promise<void> {
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
    if (body === undefined) return

    const matchId = body.matchId
    if (typeof matchId !== 'number') {
      sendError(response, 'VALIDATION_ERROR', 'matchId is required', 400)
      return
    }

    try {
      const match = await this.application.core.databaseManager.queryOne<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 AND "tournamentId" = $2',
        [matchId, tournamentId]
      )
      if (match === undefined) {
        sendError(response, 'NOT_FOUND', 'Match not found in this tournament', 404)
        return
      }

      await this.application.core.tournamentManager.rewindMatch(matchId, auth.userId)
      this.logger.info(`API /api/tournament/${tournamentId}/undo: Rewound match ${matchId}`)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to undo match:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleResults(response: http.ServerResponse, tournamentId: number): Promise<void> {
    try {
      const results = await this.application.core.databaseManager.queryRows<TournamentResult>(
        'SELECT * FROM "tournament_results" WHERE "tournamentId" = $1 ORDER BY "placement" ASC, "wins" DESC',
        [tournamentId]
      )
      sendSuccess(response, results)
    } catch (error: unknown) {
      this.logger.error('Failed to get tournament results:', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to get tournament results', 500)
    }
  }

  private async handleOpenCheckin(response: http.ServerResponse, tournamentId: number): Promise<void> {
    try {
      await this.application.core.tournamentManager.openCheckinManually(tournamentId)
    } catch (error: unknown) {
      this.logger.error('Failed to open check-in:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
      return
    }

    try {
      const tournament = await this.application.core.tournamentManager.getTournament(tournamentId)
      if (tournament !== undefined) {
        const notificationChannelId = this.application.core.bridgeConfigurations.getTournamentNotificationChannelId(
          tournament.bridgeId
        )
        if (notificationChannelId) {
          const client = this.application.discordInstance.getClient()
          const channel = await client.channels.fetch(notificationChannelId).catch(() => undefined)
          if (channel?.isTextBased() && 'send' in channel) {
            const checkinMessage = await channel
              .send({ embeds: [buildCheckinAnnouncementEmbed(tournament)] })
              .catch(() => undefined)
            if (checkinMessage !== undefined) {
              await checkinMessage
                .edit({ components: buildCheckinComponents(tournament.id, checkinMessage.id) })
                .catch(() => undefined)
            }
          }
        }
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to post check-in announcement for tournament ${tournamentId}`, error)
    }

    sendSuccess(response, { success: true })
  }

  private async handleAddPlayer(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number
  ): Promise<void> {
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
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
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
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

  private async handleSeeds(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number,
    auth: { permission: Permission; userId?: string }
  ): Promise<void> {
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
    if (body === undefined) return

    const seeds = body.seeds
    if (!Array.isArray(seeds)) {
      sendError(response, 'VALIDATION_ERROR', 'seeds array is required', 400)
      return
    }
    for (const entry of seeds) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as { playerId?: unknown }).playerId !== 'number' ||
        typeof (entry as { seed?: unknown }).seed !== 'number'
      ) {
        sendError(response, 'VALIDATION_ERROR', 'Each seed entry must be { playerId, seed }', 400)
        return
      }
    }

    try {
      await this.application.core.tournamentManager.setSeeds(
        tournamentId,
        seeds as { playerId: number; seed: number }[],
        auth.userId ?? 'web-ui'
      )
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to update seeds:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleEdit(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number,
    auth: { permission: Permission; userId?: string }
  ): Promise<void> {
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
    if (body === undefined) return

    const updates: {
      name?: string
      gameType?: string
      bestOf?: number
      roundDeadlineHours?: number
      checkinWindowMinutes?: number
      bracketFormat?: string
    } = {}
    if (body.name !== undefined) {
      if (typeof body.name !== 'string') {
        this.sendValidation(response, 'name must be a string')
        return
      }
      updates.name = body.name
    }
    if (body.gameType !== undefined) {
      if (typeof body.gameType !== 'string') {
        this.sendValidation(response, 'gameType must be a string')
        return
      }
      updates.gameType = body.gameType
    }
    if (body.bestOf !== undefined) {
      if (typeof body.bestOf !== 'number') {
        this.sendValidation(response, 'bestOf must be a number')
        return
      }
      updates.bestOf = body.bestOf
    }
    if (body.roundDeadlineHours !== undefined) {
      if (typeof body.roundDeadlineHours !== 'number') {
        this.sendValidation(response, 'roundDeadlineHours must be a number')
        return
      }
      updates.roundDeadlineHours = body.roundDeadlineHours
    }
    if (body.checkinWindowMinutes !== undefined) {
      if (typeof body.checkinWindowMinutes !== 'number') {
        this.sendValidation(response, 'checkinWindowMinutes must be a number')
        return
      }
      updates.checkinWindowMinutes = body.checkinWindowMinutes
    }
    if (body.bracketFormat !== undefined) {
      if (typeof body.bracketFormat !== 'string') {
        this.sendValidation(response, 'bracketFormat must be a string')
        return
      }
      updates.bracketFormat = body.bracketFormat
    }

    try {
      const tournament = await this.application.core.tournamentManager.updateTournament(
        tournamentId,
        updates,
        auth.userId ?? 'web-ui'
      )
      sendSuccess(response, tournament)
    } catch (error: unknown) {
      this.logger.error('Failed to update tournament:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleReopen(
    response: http.ServerResponse,
    tournamentId: number,
    auth: { permission: Permission; userId?: string }
  ): Promise<void> {
    try {
      const tournament = await this.application.core.tournamentManager.reopenTournament(
        tournamentId,
        auth.userId ?? 'web-ui'
      )
      sendSuccess(response, tournament)
    } catch (error: unknown) {
      this.logger.error('Failed to reopen tournament:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleAdvanceBye(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tournamentId: number,
    auth: { permission: Permission; userId?: string }
  ): Promise<void> {
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
    if (body === undefined) return

    const matchId = body.matchId
    if (typeof matchId !== 'number') {
      sendError(response, 'VALIDATION_ERROR', 'matchId is required', 400)
      return
    }

    try {
      const match = await this.application.core.databaseManager.queryOne<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 AND "tournamentId" = $2',
        [matchId, tournamentId]
      )
      if (match === undefined) {
        sendError(response, 'NOT_FOUND', 'Match not found in this tournament', 404)
        return
      }
      if (match.status !== MatchStatus.Bye) {
        sendError(response, 'VALIDATION_ERROR', 'Match is not a BYE match', 400)
        return
      }
      if (match.winnerId === undefined) {
        sendError(response, 'VALIDATION_ERROR', 'BYE match has no winner set', 400)
        return
      }
      await this.application.core.tournamentManager.matchManager.resolveByeMatch(matchId, match.winnerId)
      await this.application.core.tournamentManager.auditLogger.log(
        tournamentId,
        'bye_advanced',
        auth.userId ?? 'web-ui',
        matchId,
        undefined,
        { round: match.round }
      )
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to advance BYE match:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private async handleProof(
    response: http.ServerResponse,
    tournamentId: number,
    rawMatchId: string | undefined
  ): Promise<void> {
    const matchId = Number(rawMatchId)
    if (!Number.isInteger(matchId) || matchId <= 0) {
      sendError(response, 'VALIDATION_ERROR', 'Valid matchId is required', 400)
      return
    }

    try {
      const match = await this.application.core.databaseManager.queryOne<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1 AND "tournamentId" = $2',
        [matchId, tournamentId]
      )
      if (match === undefined) {
        sendError(response, 'NOT_FOUND', 'Match not found in this tournament', 404)
        return
      }
      if (match.discordThreadId === undefined) {
        sendSuccess(response, { matchId, proof: [] })
        return
      }
      const proof = await this.application.core.tournamentManager.channelManager.getProofUrls(match.discordThreadId)
      sendSuccess(response, { matchId, proof })
    } catch (error: unknown) {
      this.logger.error('Failed to fetch match proof:', error)
      sendError(response, 'INTERNAL_ERROR', String(error), 500)
    }
  }

  private sendValidation(response: http.ServerResponse, message: string): void {
    sendError(response, 'VALIDATION_ERROR', message, 400)
  }

  private async handleTestCreate(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    auth: { permission: Permission; userId?: string }
  ): Promise<void> {
    const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
    if (body === undefined) return

    const bridgeId = body.bridgeId
    if (typeof bridgeId !== 'string' || bridgeId.trim().length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'bridgeId is required', 400)
      return
    }

    const config = this.application.core.bridgeConfigurations
    const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : 'Test Tournament'
    const gameType =
      typeof body.gameType === 'string' && body.gameType.trim().length > 0 ? body.gameType.trim() : 'Bridge'
    const bestOf = typeof body.bestOf === 'number' ? body.bestOf : config.getTournamentDefaultBestOf(bridgeId)
    if (!Number.isInteger(bestOf) || bestOf < 1 || bestOf % 2 === 0) {
      sendError(response, 'VALIDATION_ERROR', 'bestOf must be a positive odd integer (e.g. 1, 3, 5)', 400)
      return
    }
    const deadline =
      typeof body.deadline === 'number' ? body.deadline : config.getTournamentDefaultDeadlineHours(bridgeId)
    const playerCount = typeof body.playerCount === 'number' ? body.playerCount : 8
    if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 32) {
      sendError(response, 'VALIDATION_ERROR', 'playerCount must be between 2 and 32', 400)
      return
    }
    const autoStart = body.autoStart !== false
    const categoryId =
      typeof body.categoryId === 'string' && body.categoryId.trim().length > 0 ? body.categoryId.trim() : undefined
    const createdBy = auth.userId ?? 'web-ui'

    try {
      const tournament = await this.application.core.tournamentManager.createTournament(
        bridgeId,
        name,
        gameType,
        bestOf,
        createdBy,
        deadline
      )

      await this.application.core.tournamentManager.auditLogger.log(
        tournament.id,
        'create_test_tournament',
        createdBy,
        undefined,
        undefined,
        { name, gameType, bestOf, playerCount, deadline, autoStart, categoryId, source: 'web' }
      )

      const now = Math.floor(Date.now() / 1000)
      const status = autoStart ? PlayerStatus.CheckedIn : PlayerStatus.Registered
      const checkedInAt = autoStart ? now : undefined
      for (let index = 0; index < playerCount; index++) {
        const fakeUuid = `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`
        await this.application.core.databaseManager.execute(
          `INSERT INTO "tournament_players" ("tournamentId", "playerUuid", "discordId", "seed", "status", "checkedInAt")
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tournament.id, fakeUuid, undefined, index + 1, status, checkedInAt]
        )
      }

      if (autoStart) {
        const bridgeGuild = await this.application.core.tournamentManager
          .resolveGuildForBridge(bridgeId)
          .catch(() => undefined)
        const guildId = bridgeGuild?.id ?? (typeof body.guildId === 'string' ? body.guildId : undefined)
        if (guildId === undefined) {
          await this.application.core.tournamentManager.cancelTournament(tournament.id).catch(() => undefined)
          sendError(
            response,
            'VALIDATION_ERROR',
            `Could not resolve a Discord guild for bridge "${bridgeId}". Configure the bridge's channels or pass guildId.`,
            400
          )
          return
        }
        try {
          await this.application.core.tournamentManager.startTournament(tournament.id, guildId, categoryId)
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          await this.application.core.tournamentManager.cancelTournament(tournament.id).catch(() => undefined)
          sendError(response, 'INTERNAL_ERROR', `Failed to start test tournament: ${message}`, 500)
          return
        }
      }

      sendSuccess(response, tournament)
    } catch (error: unknown) {
      this.logger.error('Failed to create test tournament:', error)
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
}
