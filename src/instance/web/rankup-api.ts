import type http from 'node:http'

import { HttpStatusCode } from 'axios'
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type { PendingReview, RankupHistoryEntry } from '../../core/rankup/pending-review-manager.js'
import { verifyToken } from './auth.js'

interface BridgeListEntry {
  bridgeId: string
  enabled: boolean
  manualReview: boolean
  pendingCount: number
  lastCheckAt: number | null
}

interface PromotionRule {
  targetRank: string
  minWeeklyGexp: number
  minDaysInGuild: number
  minOnlineHours: number
}

interface DemotionRule {
  fromRank: string
  action: 'demote' | 'kick' | 'notify'
  targetRank?: string
  maxWeeklyGexp: number
  gracePeriod: number
}

interface RulesResponse {
  enabled: boolean
  manualReview: boolean
  notificationCooldown: number
  notificationChannelIds: string[]
  notificationChannels: { id: string; name: string | null }[]
  promotionRules: PromotionRule[]
  demotionRules: DemotionRule[]
  excludedRanks: string[]
  excludedPlayers: string[]
}

const PREFIX = '/api/rankup'
const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 200

export class RankupApiHandler {
  private readonly lastCheckByBridge = new Map<string, number>()

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  private verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): boolean {
    const webConfig = this.application.getWebConfig()
    if (!webConfig || !webConfig.token) return false
    const authHeader = request.headers.authorization
    const result = verifyToken(webConfig.token, authHeader)
    if (result.ok) return true
    this.sendJson(response, HttpStatusCode.Unauthorized, { success: false, error: 'Invalid token' })
    return false
  }

  public async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart, queryPart] = rawUrl.split('?')
    if (!pathPart || (!pathPart.startsWith(PREFIX + '/') && pathPart !== PREFIX)) {
      return false
    }

    const method = request.method ?? 'GET'
    const query = this.parseQuery(queryPart)

    if (!this.verifyAuth(request, response)) return true

    if (pathPart === `${PREFIX}/bridges`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      this.handleBridgesList(response)
      return true
    }

    if (pathPart === `${PREFIX}/pending`) {
      const bridgeId = this.requireBridgeId(query, response)
      if (bridgeId === null) return true
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handlePendingList(response, bridgeId)
      return true
    }

    if (pathPart === `${PREFIX}/history`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      const bridgeId = this.requireBridgeId(query, response)
      if (bridgeId === null) return true
      const limit = this.parseLimit(query.limit)
      await this.handleHistory(response, bridgeId, limit)
      return true
    }

    if (pathPart === `${PREFIX}/rules`) {
      const bridgeId = this.requireBridgeId(query, response)
      if (bridgeId === null) return true
      if (method === 'GET') {
        await this.handleGetRules(response, bridgeId)
        return true
      }
      if (method === 'PUT') {
        await this.handlePutRules(request, response, bridgeId)
        return true
      }
      this.sendMethodNotAllowed(response, ['GET', 'PUT'])
      return true
    }

    if (pathPart === `${PREFIX}/guild-ranks`) {
      const bridgeId = this.requireBridgeId(query, response)
      if (bridgeId === null) return true
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleGuildRanks(response, bridgeId)
      return true
    }

    if (pathPart === `${PREFIX}/check-player`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleCheckPlayer(response, query)
      return true
    }

    if (pathPart === `${PREFIX}/run-check`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      await this.handleRunCheck(request, response)
      return true
    }

    if (pathPart === `${PREFIX}/status`) {
      const bridgeId = this.requireBridgeId(query, response)
      if (bridgeId === null) return true
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      this.handleStatus(response, bridgeId)
      return true
    }

    if (pathPart.startsWith(`${PREFIX}/pending/`)) {
      const segments = pathPart.slice(`${PREFIX}/pending/`.length).split('/')
      if (segments.length !== 2) {
        this.sendJson(response, HttpStatusCode.NotFound, { success: false, error: 'Not found' })
        return true
      }
      const [idRaw, action] = segments
      const id = Number(idRaw)
      this.logger.debug('Pending review action: path=%s, idRaw=%s, parsedId=%d, action=%s', pathPart, idRaw, id, action)
      if (!Number.isInteger(id) || id <= 0) {
        this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Invalid review id' })
        return true
      }
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (action === 'approve') {
        await this.handleApprove(response, id)
        return true
      }
      if (action === 'reject') {
        await this.handleReject(response, id)
        return true
      }
      this.sendJson(response, HttpStatusCode.NotFound, { success: false, error: 'Not found' })
      return true
    }

    return false
  }

  private handleBridgesList(response: http.ServerResponse): void {
    const bridgeConfigurations = this.application.core.bridgeConfigurations
    const pendingReviewManager = this.application.core.pendingReviewManager
    const bridgeIds = bridgeConfigurations.getAllBridgeIds()

    const bridges: BridgeListEntry[] = bridgeIds.map((bridgeId) => ({
      bridgeId,
      enabled: bridgeConfigurations.getRankupEnabled(bridgeId),
      manualReview: bridgeConfigurations.getRankupManualReview(bridgeId),
      pendingCount: pendingReviewManager.getReviews(bridgeId).length,
      lastCheckAt: this.lastCheckByBridge.get(bridgeId) ?? null
    }))

    this.sendJson(response, HttpStatusCode.Ok, { bridges })
  }

  private async handlePendingList(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const reviews: PendingReview[] = this.application.core.pendingReviewManager.getReviews(bridgeId)
    const reviewsWithNames = await this.resolveNames(reviews)
    this.sendJson(response, HttpStatusCode.Ok, { reviews: reviewsWithNames })
  }

  private async handleHistory(response: http.ServerResponse, bridgeId: string, limit: number): Promise<void> {
    const history: RankupHistoryEntry[] = this.application.core.pendingReviewManager.getHistory(bridgeId, limit)
    const historyWithNames = await this.resolveNames(history)
    this.sendJson(response, HttpStatusCode.Ok, { history: historyWithNames })
  }

  private async handleGetRules(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const cfg = this.application.core.bridgeConfigurations
    const channelIds = cfg.getRankupNotificationChannelIds(bridgeId)

    const notificationChannels: { id: string; name: string | null }[] = []
    const client = this.application.discordInstance?.getClient()
    for (const id of channelIds) {
      let name: string | null = null
      if (client) {
        const ch = await client.channels.fetch(id).catch(() => undefined)
        if (ch && 'name' in ch) {
          name = (ch as { name: string }).name
        }
      }
      notificationChannels.push({ id, name })
    }

    const rules: RulesResponse = {
      enabled: cfg.getRankupEnabled(bridgeId),
      manualReview: cfg.getRankupManualReview(bridgeId),
      notificationCooldown: cfg.getRankupNotificationCooldown(bridgeId),
      notificationChannelIds: channelIds,
      notificationChannels,
      promotionRules: cfg.getRankupRules(bridgeId),
      demotionRules: cfg.getRankupDemotionRules(bridgeId),
      excludedRanks: cfg.getRankupExcludedRanks(bridgeId),
      excludedPlayers: cfg.getRankupExcludedPlayers(bridgeId)
    }
    this.sendJson(response, HttpStatusCode.Ok, rules)
  }

  private async handlePutRules(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    bridgeId: string
  ): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const error = this.validateRulesBody(body)
    if (error !== null) {
      this.sendError(response, HttpStatusCode.BadRequest, error)
      return
    }

    const cfg = this.application.core.bridgeConfigurations
    const rules = body as unknown as RulesResponse
    cfg.setRankupEnabled(bridgeId, rules.enabled)
    cfg.setRankupManualReview(bridgeId, rules.manualReview)
    cfg.setRankupNotificationCooldown(bridgeId, rules.notificationCooldown)
    cfg.setRankupNotificationChannelIds(bridgeId, rules.notificationChannelIds)
    cfg.setRankupRules(bridgeId, rules.promotionRules)
    cfg.setRankupDemotionRules(bridgeId, rules.demotionRules)
    cfg.setRankupExcludedRanks(bridgeId, rules.excludedRanks)
    cfg.setRankupExcludedPlayers(bridgeId, rules.excludedPlayers)

    this.sendJson(response, HttpStatusCode.Ok, { success: true })
  }

  private async handleGuildRanks(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const instances = this.application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
    if (instances.length === 0) {
      this.sendError(response, HttpStatusCode.BadRequest, 'No Minecraft instances configured for this bridge')
      return
    }

    const botInstanceName = instances[0]
    const mcInstance = this.application.minecraftManager
      .getAllInstances()
      .find((inst) => inst.instanceName.toLowerCase() === botInstanceName.toLowerCase())
    const botUuid = mcInstance?.uuid()

    if (!botUuid) {
      this.sendError(response, HttpStatusCode.BadRequest, 'Minecraft instance is not connected or UUID is unavailable')
      return
    }

    try {
      this.logger.debug(`Fetching guild ranks for bridge ${bridgeId} using bot UUID ${botUuid}`)
      const guild = await this.application.hypixelApi.getGuild('player', botUuid, {})
      if (!guild) {
        this.logger.info(`Guild not found for bridge ${bridgeId} (bot UUID: ${botUuid}) — returning empty ranks`)
        this.sendJson(response, HttpStatusCode.Ok, { ranks: [] })
        return
      }
      const rankNames = guild.ranks.map((r) => r.name)
      this.logger.debug(`Fetched ${rankNames.length} guild ranks for bridge ${bridgeId}: [${rankNames.join(', ')}]`)
      this.sendJson(response, HttpStatusCode.Ok, { ranks: rankNames })
    } catch (error: unknown) {
      this.logger.error(`Failed to fetch guild ranks for bridge ${bridgeId} (bot UUID: ${botUuid}):`, error)
      this.sendError(response, HttpStatusCode.BadGateway, 'Failed to fetch guild ranks')
    }
  }

  private async handleCheckPlayer(
    response: http.ServerResponse,
    query: Record<string, string | string[]>
  ): Promise<void> {
    const bridgeId = this.requireBridgeId(query, response)
    if (bridgeId === null) return

    const usernameRaw = query.username
    const username = Array.isArray(usernameRaw) ? usernameRaw[0] : usernameRaw
    if (!username || username.length === 0) {
      this.sendError(response, HttpStatusCode.BadRequest, 'Missing or empty username')
      return
    }

    const uuid = await this.application.mojangApi
      .profileByUsername(username)
      .then((p) => p.id)
      .catch(() => undefined)
    if (!uuid) {
      this.sendError(response, HttpStatusCode.BadRequest, 'Invalid username')
      return
    }

    const bridgeConfig = this.application.core.bridgeConfigurations

    const instances = bridgeConfig.getMinecraftInstances(bridgeId)
    if (instances.length === 0) {
      this.sendError(response, HttpStatusCode.BadRequest, 'No Minecraft instances configured for this bridge')
      return
    }

    const botName = instances[0]
    const guild = await this.application.hypixelApi.getGuild('player', botName, {}).catch(() => undefined)
    if (!guild) {
      this.sendError(response, HttpStatusCode.BadGateway, 'Could not fetch guild data')
      return
    }

    const member = guild.members.find((m) => m.uuid === uuid)
    if (!member) {
      this.sendError(response, HttpStatusCode.NotFound, 'Player is not in the guild')
      return
    }

    const promotionRules = bridgeConfig.getRankupRules(bridgeId)
    const demotionRules = bridgeConfig.getRankupDemotionRules(bridgeId)
    const excludedRanks = bridgeConfig.getRankupExcludedRanks(bridgeId)
    const excludedPlayers = bridgeConfig.getRankupExcludedPlayers(bridgeId)

    const rankPriority = guild.ranks.toSorted((a, b) => a.priority - b.priority).map((r) => r.name.toLowerCase())

    const weeklyGexp = member.weeklyExperience ?? 0

    const stats = {
      uuid: member.uuid,
      rank: member.rank,
      joinedAt: member.joinedAt.getTime(),
      weeklyGexp,
      lastOnline: 0
    }

    const { RulesEvaluator } = await import('../../core/rankup/rules-evaluator.js')
    const evaluator = new RulesEvaluator()
    const result = evaluator.evaluate(
      stats,
      promotionRules,
      demotionRules,
      excludedRanks,
      excludedPlayers,
      rankPriority
    )

    this.sendJson(response, HttpStatusCode.Ok, {
      uuid,
      username,
      currentRank: member.rank,
      weeklyGexp,
      daysInGuild: ((Date.now() - stats.joinedAt) / (1000 * 60 * 60 * 24)).toFixed(1),
      action: result.action,
      targetRank: 'targetRank' in result ? result.targetRank : undefined,
      reason: 'reason' in result ? result.reason : undefined
    })
  }

  private async handleRunCheck(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      this.sendError(response, HttpStatusCode.BadRequest, 'Invalid body')
      return
    }

    const bridgeId = (body as { bridgeId?: unknown }).bridgeId
    if (typeof bridgeId !== 'string' || bridgeId.length === 0) {
      this.sendError(response, HttpStatusCode.BadRequest, 'Missing or empty bridgeId')
      return
    }

    const rankupManager = this.application.core.rankupManager
    void rankupManager.runTaskForBridge(bridgeId).catch((error: unknown) => {
      this.logger.error(`Rankup run-check failed for bridge ${bridgeId}:`, error)
    })

    this.lastCheckByBridge.set(bridgeId, Date.now())
    this.sendJson(response, HttpStatusCode.Ok, { success: true })
  }

  private handleStatus(response: http.ServerResponse, bridgeId: string): void {
    this.sendJson(response, HttpStatusCode.Ok, {
      running: false,
      lastCheckAt: this.lastCheckByBridge.get(bridgeId) ?? null,
      nextCheckAt: null
    })
  }

  private async handleApprove(response: http.ServerResponse, id: number): Promise<void> {
    this.logger.debug('handleApprove: id=%d', id)
    const review = this.application.core.pendingReviewManager.getReview(id)
    if (review === undefined) {
      this.sendError(response, HttpStatusCode.NotFound, 'Review not found')
      return
    }

    try {
      await this.application.core.rankupManager.approveReview(review.bridgeId, id)
      this.sendJson(response, HttpStatusCode.Ok, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to approve review %d: %s', id, error)
      this.sendError(response, HttpStatusCode.InternalServerError, 'Failed to approve review')
    }
  }

  private async handleReject(response: http.ServerResponse, id: number): Promise<void> {
    this.logger.debug('handleReject: id=%d', id)
    const review = this.application.core.pendingReviewManager.getReview(id)
    if (review === undefined) {
      this.sendError(response, HttpStatusCode.NotFound, 'Review not found')
      return
    }

    this.application.core.pendingReviewManager.logHistory(
      review.bridgeId,
      review.uuid,
      'reject',
      review.currentRank,
      review.proposedRank,
      'web'
    )
    this.application.core.pendingReviewManager.removeReview(id)
    this.sendJson(response, HttpStatusCode.Ok, { success: true })
  }

  private validateRulesBody(body: unknown): string | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return 'Body must be an object'
    }
    const b = body as Record<string, unknown>

    if (typeof b.enabled !== 'boolean') return 'enabled must be a boolean'
    if (typeof b.manualReview !== 'boolean') return 'manualReview must be a boolean'
    if (typeof b.notificationCooldown !== 'number' || !Number.isFinite(b.notificationCooldown)) {
      return 'notificationCooldown must be a number'
    }
    if (!Array.isArray(b.notificationChannelIds) || !b.notificationChannelIds.every((v) => typeof v === 'string')) {
      return 'notificationChannelIds must be an array of strings'
    }
    if (!Array.isArray(b.excludedRanks) || !b.excludedRanks.every((v) => typeof v === 'string')) {
      return 'excludedRanks must be an array of strings'
    }
    if (!Array.isArray(b.excludedPlayers) || !b.excludedPlayers.every((v) => typeof v === 'string')) {
      return 'excludedPlayers must be an array of strings'
    }

    if (!Array.isArray(b.promotionRules)) return 'promotionRules must be an array'
    for (const rule of b.promotionRules) {
      const error = this.validatePromotionRule(rule)
      if (error !== null) return `promotionRules: ${error}`
    }

    if (!Array.isArray(b.demotionRules)) return 'demotionRules must be an array'
    for (const rule of b.demotionRules) {
      const error = this.validateDemotionRule(rule)
      if (error !== null) return `demotionRules: ${error}`
    }

    return null
  }

  private validatePromotionRule(rule: unknown): string | null {
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
      return 'rule must be an object'
    }
    const r = rule as Record<string, unknown>
    if (typeof r.targetRank !== 'string') return 'targetRank must be a string'
    if (typeof r.minWeeklyGexp !== 'number' || !Number.isFinite(r.minWeeklyGexp)) {
      return 'minWeeklyGexp must be a number'
    }
    if (typeof r.minDaysInGuild !== 'number' || !Number.isFinite(r.minDaysInGuild)) {
      return 'minDaysInGuild must be a number'
    }
    if (typeof r.minOnlineHours !== 'number' || !Number.isFinite(r.minOnlineHours)) {
      return 'minOnlineHours must be a number'
    }
    return null
  }

  private validateDemotionRule(rule: unknown): string | null {
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
      return 'rule must be an object'
    }
    const r = rule as Record<string, unknown>
    if (typeof r.fromRank !== 'string') return 'fromRank must be a string'
    if (r.action !== 'demote' && r.action !== 'kick' && r.action !== 'notify') {
      return 'action must be "demote", "kick", or "notify"'
    }
    if (r.targetRank !== undefined && typeof r.targetRank !== 'string') {
      return 'targetRank must be a string when present'
    }
    if (typeof r.maxWeeklyGexp !== 'number' || !Number.isFinite(r.maxWeeklyGexp)) {
      return 'maxWeeklyGexp must be a number'
    }
    if (typeof r.gracePeriod !== 'number' || !Number.isFinite(r.gracePeriod)) {
      return 'gracePeriod must be a number'
    }
    return null
  }

  private parseQuery(queryPart: string | undefined): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {}
    if (!queryPart) return out
    const parameters = new URLSearchParams(queryPart)
    for (const [key, value] of parameters.entries()) {
      if (key in out) {
        const existing = out[key]
        if (Array.isArray(existing)) {
          existing.push(value)
        } else {
          out[key] = [existing, value]
        }
      } else {
        out[key] = value
      }
    }
    return out
  }

  private parseLimit(raw: string | string[] | undefined): number {
    const candidate = Array.isArray(raw) ? raw[0] : raw
    const parsed = candidate === undefined ? DEFAULT_HISTORY_LIMIT : Number(candidate)
    if (!Number.isFinite(parsed)) return DEFAULT_HISTORY_LIMIT
    const clamped = Math.floor(parsed)
    if (clamped < 1) return 1
    if (clamped > MAX_HISTORY_LIMIT) return MAX_HISTORY_LIMIT
    return clamped
  }

  private async resolveNames<T extends { uuid: string }>(items: T[]): Promise<(T & { name?: string })[]> {
    const uuids = [...new Set(items.map((r) => r.uuid))]
    const names = new Map<string, string>()
    await Promise.all(
      uuids.map(async (uuid) => {
        try {
          const profile = await this.application.mojangApi.profileByUuid(uuid)
          names.set(uuid, profile.name)
        } catch {
          // UUID not resolvable; name stays undefined
        }
      })
    )
    return items.map((item) => ({ ...item, name: names.get(item.uuid) }))
  }

  private requireBridgeId(query: Record<string, string | string[]>, response: http.ServerResponse): string | null {
    const raw = query.bridgeId
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value === undefined || value.length === 0) {
      this.sendError(response, HttpStatusCode.BadRequest, 'Missing or empty bridgeId')
      return null
    }
    return value
  }

  private async readJsonBody(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<unknown | undefined> {
    let raw: string
    try {
      raw = await this.readBody(request)
    } catch (error: unknown) {
      this.logger.warn('Failed to read request body', error)
      this.sendError(response, HttpStatusCode.BadRequest, 'Failed to read request body')
      return undefined
    }

    if (raw.length === 0) {
      this.sendError(response, HttpStatusCode.BadRequest, 'Missing request body')
      return undefined
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error: unknown) {
      this.logger.warn('Invalid JSON body', error)
      this.sendError(response, HttpStatusCode.BadRequest, 'Invalid JSON body')
      return undefined
    }

    return parsed
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

  private sendJson(response: http.ServerResponse, status: number, body: object): void {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  private sendError(response: http.ServerResponse, status: number, error: string): void {
    this.sendJson(response, status, { success: false, error })
  }

  private sendMethodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '))
    this.sendJson(response, HttpStatusCode.MethodNotAllowed, { success: false, error: 'Method not allowed' })
  }
}
