import type http from 'node:http'

import { Permission } from '../../common/application-event.js'
import type { PendingReview, RankupHistoryEntry } from '../../core/rankup/pending-review-manager.js'

import { readJsonBody, sendError, sendSuccess } from './api-utils.js'
import { BaseApiHandler } from './base-api.js'

interface BridgeListEntry {
  bridgeId: string
  enabled: boolean
  manualReview: boolean
  pendingCount: number
  lastCheckAt: number | undefined
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
  maxDaysInactive?: number
}

interface RulesResponse {
  enabled: boolean
  manualReview: boolean
  notificationCooldown: number
  notificationChannelIds: string[]
  notificationChannels?: { id: string; name: string | undefined }[]
  promotionRules: PromotionRule[]
  demotionRules: DemotionRule[]
  excludedRanks: string[]
  excludedPlayers: string[]
}

const PREFIX = '/api/rankup'
const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 200

export class RankupApiHandler extends BaseApiHandler {
  private readonly lastCheckByBridge = new Map<string, number>()

  public async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart, queryPart] = rawUrl.split('?')
    if (!pathPart || (!pathPart.startsWith(PREFIX + '/') && pathPart !== PREFIX)) {
      return false
    }

    const method = request.method ?? 'GET'
    const query = this.parseQuery(queryPart)

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    if (permission < Permission.Helper) {
      sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
      return true
    }

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
      if (bridgeId === undefined) return true
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
      if (bridgeId === undefined) return true
      const limit = this.parseLimit(query.limit)
      await this.handleHistory(response, bridgeId, limit)
      return true
    }

    if (pathPart === `${PREFIX}/rules`) {
      const bridgeId = this.requireBridgeId(query, response)
      if (bridgeId === undefined) return true
      if (method === 'GET') {
        await this.handleGetRules(response, bridgeId)
        return true
      }
      if (method === 'PUT' && permission < Permission.Owner) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
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
      if (bridgeId === undefined) return true
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
      if (bridgeId === undefined) return true
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
        sendError(response, 'NOT_FOUND', 'Not found', 404)
        return true
      }
      const [idRaw, action] = segments
      const id = Number(idRaw)
      if (!Number.isInteger(id) || id <= 0) {
        sendError(response, 'VALIDATION_ERROR', 'Invalid review id', 400)
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
        this.handleReject(response, id)
        return true
      }
      sendError(response, 'NOT_FOUND', 'Not found', 404)
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
      lastCheckAt: this.lastCheckByBridge.get(bridgeId)
    }))

    sendSuccess(response, { bridges })
  }

  private async handlePendingList(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const reviews: PendingReview[] = this.application.core.pendingReviewManager.getReviews(bridgeId)
    const reviewsWithNames = await this.resolveNames(reviews)
    sendSuccess(response, { reviews: reviewsWithNames })
  }

  private async handleHistory(response: http.ServerResponse, bridgeId: string, limit: number): Promise<void> {
    const history: RankupHistoryEntry[] = this.application.core.pendingReviewManager.getHistory(bridgeId, limit)
    const historyWithNames = await this.resolveNames(history)
    sendSuccess(response, { history: historyWithNames })
  }

  private async handleGetRules(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const cfg = this.application.core.bridgeConfigurations
    const channelIds = cfg.getRankupNotificationChannelIds(bridgeId)

    const notificationChannels: { id: string; name: string | undefined }[] = []
    const client = this.application.discordInstance.getClient()
    for (const id of channelIds) {
      let name: string | undefined
      const ch = await client.channels.fetch(id).catch(() => undefined)
      if (ch && 'name' in ch) {
        name = (ch as { name: string }).name
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
    sendSuccess(response, rules)
  }

  private async handlePutRules(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    bridgeId: string
  ): Promise<void> {
    const body = await readJsonBody(request, response, this.logger)
    if (body === undefined) return

    const error = this.validateRulesBody(body)
    if (error !== undefined) {
      sendError(response, 'VALIDATION_ERROR', error, 400)
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

    sendSuccess(response, { success: true })
  }

  private async handleGuildRanks(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const instances = this.application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
    if (instances.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'No Minecraft instances configured for this bridge', 400)
      return
    }

    const botInstanceName = instances[0]
    const mcInstance = this.application.minecraftManager
      .getAllInstances()
      .find((inst) => inst.instanceName.toLowerCase() === botInstanceName.toLowerCase())
    const botUuid = mcInstance?.uuid()

    if (!botUuid) {
      sendError(response, 'INTERNAL_ERROR', 'Minecraft instance is not connected or UUID is unavailable', 502)
      return
    }

    try {
      const guild = await this.application.hypixelApi.getGuild('player', botUuid, {})
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- getGuild('player', ...) returns null at runtime for players without a guild despite the Promise<Guild> typing
      if (!guild) {
        this.logger.info(`Guild not found for bridge ${bridgeId} (bot UUID: ${botUuid}) — returning empty ranks`)
        sendSuccess(response, { ranks: [] })
        return
      }
      const rankNames = guild.ranks.map((r) => r.name)
      sendSuccess(response, { ranks: rankNames })
    } catch (error: unknown) {
      this.logger.error(`Failed to fetch guild ranks for bridge ${bridgeId} (bot UUID: ${botUuid}):`, error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to fetch guild ranks', 502)
    }
  }

  private async handleCheckPlayer(
    response: http.ServerResponse,
    query: Record<string, string | string[]>
  ): Promise<void> {
    const bridgeId = this.requireBridgeId(query, response)
    if (bridgeId === undefined) return

    const usernameRaw = query.username
    const username = Array.isArray(usernameRaw) ? usernameRaw[0] : usernameRaw
    if (!username || username.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or empty username', 400)
      return
    }

    const uuid = await this.application.mojangApi
      .profileByUsername(username)
      .then((p) => p.id)
      .catch(() => undefined)
    if (!uuid) {
      sendError(response, 'VALIDATION_ERROR', 'Invalid username', 400)
      return
    }

    const bridgeConfig = this.application.core.bridgeConfigurations

    const instances = bridgeConfig.getMinecraftInstances(bridgeId)
    if (instances.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'No Minecraft instances configured for this bridge', 400)
      return
    }

    const botName = instances[0]
    const guild = await this.application.hypixelApi.getGuild('player', botName, {}).catch(() => undefined)
    if (!guild) {
      sendError(response, 'INTERNAL_ERROR', 'Could not fetch guild data', 502)
      return
    }

    const member = guild.members.find((m) => m.uuid === uuid)
    if (!member) {
      sendError(response, 'NOT_FOUND', 'Player is not in the guild', 404)
      return
    }

    const promotionRules = bridgeConfig.getRankupRules(bridgeId)
    const demotionRules = bridgeConfig.getRankupDemotionRules(bridgeId)
    const excludedRanks = bridgeConfig.getRankupExcludedRanks(bridgeId)
    const excludedPlayers = bridgeConfig.getRankupExcludedPlayers(bridgeId)

    const rankPriority = guild.ranks.toSorted((a, b) => a.priority - b.priority).map((r) => r.name.toLowerCase())

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hypixel-api-reborn sets weeklyExperience to null at runtime when expHistory is missing despite the number typing
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

    sendSuccess(response, {
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
    const body = await readJsonBody(request, response, this.logger)
    if (body === undefined) return

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      sendError(response, 'VALIDATION_ERROR', 'Invalid body', 400)
      return
    }

    const bridgeId = (body as { bridgeId?: unknown }).bridgeId
    if (typeof bridgeId !== 'string' || bridgeId.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or empty bridgeId', 400)
      return
    }

    const rankupManager = this.application.core.rankupManager
    void rankupManager.runTaskForBridge(bridgeId).catch((error: unknown) => {
      this.logger.error(`Rankup run-check failed for bridge ${bridgeId}:`, error)
    })

    this.lastCheckByBridge.set(bridgeId, Date.now())
    sendSuccess(response, { success: true })
  }

  private handleStatus(response: http.ServerResponse, bridgeId: string): void {
    sendSuccess(response, {
      running: false,
      lastCheckAt: this.lastCheckByBridge.get(bridgeId),
      nextCheckAt: undefined
    })
  }

  private async handleApprove(response: http.ServerResponse, id: number): Promise<void> {
    const review = this.application.core.pendingReviewManager.getReview(id)
    if (review === undefined) {
      sendError(response, 'NOT_FOUND', 'Review not found', 404)
      return
    }

    try {
      await this.application.core.rankupManager.approveReview(review.bridgeId, id)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to approve review %d: %s', id, error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to approve review', 500)
    }
  }

  private handleReject(response: http.ServerResponse, id: number): void {
    const review = this.application.core.pendingReviewManager.getReview(id)
    if (review === undefined) {
      sendError(response, 'NOT_FOUND', 'Review not found', 404)
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
    sendSuccess(response, { success: true })
  }

  private validateRulesBody(body: unknown): string | undefined {
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
      if (error !== undefined) return `promotionRules: ${error}`
    }

    if (!Array.isArray(b.demotionRules)) return 'demotionRules must be an array'
    for (const rule of b.demotionRules) {
      const error = this.validateDemotionRule(rule)
      if (error !== undefined) return `demotionRules: ${error}`
    }

    return undefined
  }

  private validatePromotionRule(rule: unknown): string | undefined {
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
    return undefined
  }

  private validateDemotionRule(rule: unknown): string | undefined {
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
    if (
      r.maxDaysInactive !== undefined &&
      r.maxDaysInactive !== null &&
      (typeof r.maxDaysInactive !== 'number' || !Number.isFinite(r.maxDaysInactive))
    ) {
      return 'maxDaysInactive must be a number when present'
    }
    return undefined
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
          // Profile lookup failed
        }
      })
    )
    return items.map((item) => ({ ...item, name: names.get(item.uuid) }))
  }

  private requireBridgeId(query: Record<string, string | string[]>, response: http.ServerResponse): string | undefined {
    const raw = query.bridgeId
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or empty bridgeId', 400)
      return undefined
    }
    return value
  }
}
