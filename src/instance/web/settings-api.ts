import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { ApplicationLanguages } from '../../core/language-configurations.js'
import Duration from '../../utility/duration.js'

import { Permission } from '../../common/application-event.js'
import { buildTokenSet, verifyToken } from './auth.js'
import { sendSuccess, sendError } from './api-utils.js'

type Primitive = boolean | number | string
type SettingObject = Record<string, Primitive | Primitive[] | Record<string, Primitive> | undefined>

const PREFIX = '/api/bridges'

function str(s: unknown, d = ''): string {
  if (typeof s === 'string') return s
  if (s === undefined || s === null) return d
  return String(s)
}

function bool(s: unknown, d = false): boolean {
  if (typeof s === 'boolean') return s
  if (s === undefined || s === null) return d
  return true
}
function boolOrUndefined(s: unknown): boolean | undefined {
  if (typeof s === 'boolean') return s
  if (s === undefined || s === null) return undefined
  return true
}

function num(s: unknown, d = 0): number {
  if (typeof s === 'number' && Number.isFinite(s)) return s
  if (typeof s === 'string') {
    const n = Number(s)
    return Number.isFinite(n) ? n : d
  }
  return d
}

function arr(s: unknown): string[] {
  if (Array.isArray(s)) return s.map(String)
  if (typeof s === 'string') {
    try {
      const p = JSON.parse(s)
      return Array.isArray(p) ? p.map(String) : []
    } catch {
      return [s]
    }
  }
  return []
}

export class SettingsApiHandler {
  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  public async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart || !pathPart.startsWith(PREFIX)) return false

    const method = (request.method ?? 'GET').toUpperCase()
    const segments = pathPart
      .slice(PREFIX.length + 1)
      .split('/')
      .filter(Boolean)

    const permission = this.verifyAuth(request, response)
    if (permission === null) return true

    // GET /api/bridges (list all bridges)
    if (method === 'GET' && segments.length === 0) {
      await this.handleBridgesList(response)
      return true
    }

    // POST /api/bridges (create a new bridge)
    if (method === 'POST' && segments.length === 0) {
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Forbidden', 403)
        return true
      }
      const body = await this.readJsonBody(request as never, response)
      if (body === undefined) return true
      await this.handleCreateBridge(response, body as { bridgeId?: unknown })
      return true
    }

    // GET /api/bridges/:bridgeId (get bridge details)
    if (method === 'GET' && segments.length === 1) {
      if (permission < Permission.Owner) {
        sendError(response, 'FORBIDDEN', 'Forbidden', 403)
        return true
      }
      await this.handleBridgeGet(response, segments[0])
      return true
    }

    // DELETE /api/bridges/:bridgeId
    if (method === 'DELETE' && segments.length === 1) {
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Forbidden', 403)
        return true
      }
      await this.handleDelete(response, segments[0])
      return true
    }

    // GET /api/bridges/:bridgeId/settings
    if (method === 'GET' && segments.length === 2 && segments[1] === 'settings') {
      if (permission < Permission.Owner) {
        sendError(response, 'FORBIDDEN', 'Forbidden', 403)
        return true
      }
      await this.handleGet(response, segments[0])
      return true
    }

    // PUT /api/bridges/:bridgeId/settings/:category
    if (method === 'PUT' && segments.length === 3 && segments[1] === 'settings') {
      if (permission < Permission.Owner) {
        sendError(response, 'FORBIDDEN', 'Forbidden', 403)
        return true
      }
      const body = await this.readJsonBody(request as never, response)
      if (body === undefined) return true
      await this.handlePut(response, segments[0], segments[2], body as SettingObject)
      return true
    }

    sendError(response, 'NOT_FOUND', 'Not found', 404)
    return true
  }

  private verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): Permission | null {
    const webConfig = this.application.config.web
    if (!webConfig || !webConfig.signingSecret) return null
    const authHeader = request.headers.authorization
    const tokens = buildTokenSet(webConfig)
    const result = verifyToken(tokens, authHeader)
    if (result.ok) return result.permission
    sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
    return null
  }

  private async handleBridgesList(response: http.ServerResponse): Promise<void> {
    try {
      const bridgeConfigurations = this.application.core.bridgeConfigurations
      const bridgeIds = bridgeConfigurations.getAllBridgeIds()
      const bridges = await Promise.all(
        bridgeIds.map(async (id) => {
          const settings = bridgeConfigurations.getAllSettings(id)
          return { id, ...settings }
        })
      )
      sendSuccess(response, bridges)
    } catch (e: unknown) {
      sendError(response, 'INTERNAL_ERROR', e instanceof Error ? e.message : 'Failed to list bridges', 500)
    }
  }

  private async handleBridgeGet(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const ids = this.application.core.bridgeConfigurations.getAllBridgeIds()
    if (!ids.includes(bridgeId)) {
      sendError(response, 'NOT_FOUND', 'Bridge not found', 404)
      return
    }
    const settings = this.application.core.bridgeConfigurations.getAllSettings(bridgeId)
    sendSuccess(response, { id: bridgeId, ...settings })
  }

  private async handleGet(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const ids = this.application.core.bridgeConfigurations.getAllBridgeIds()
    if (!ids.includes(bridgeId)) {
      sendError(response, 'NOT_FOUND', 'Bridge not found', 404)
      return
    }

    const categories = this.application.core.bridgeConfigurations.getAllSettings(bridgeId)

    // Collect channel IDs for name resolution
    const channelIds = new Set<string>()
    for (const id of arr((categories.channels as SettingObject)?.publicChannelIds)) channelIds.add(id)
    for (const id of arr((categories.channels as SettingObject)?.officerChannelIds)) channelIds.add(id)
    for (const id of arr((categories.channels as SettingObject)?.loggerChannelIds)) channelIds.add(id)
    for (const id of arr((categories.channels as SettingObject)?.promoteChannelIds)) channelIds.add(id)
    for (const id of arr((categories.rankup as SettingObject)?.notificationChannelIds)) channelIds.add(id)

    // Collect role IDs for name resolution
    const roleIds = new Set<string>()
    for (const id of arr((categories.staffRoles as SettingObject)?.helperRoleIds)) roleIds.add(id)

    for (const id of arr((categories.staffRoles as SettingObject)?.ownerRoleIds)) roleIds.add(id)

    const resolvedChannels: { id: string; name: string | null }[] = []
    const client = this.application.discordInstance?.getClient?.()
    for (const id of channelIds) {
      let name: string | null = null
      if (client) {
        try {
          const ch = await client.channels.fetch(id).catch(() => undefined)
          if (ch && 'name' in ch) name = (ch as { name: string }).name
        } catch {
          // not resolvable
        }
      }
      resolvedChannels.push({ id, name })
    }

    const resolvedRoles: { id: string; name: string | null }[] = []
    for (const id of roleIds) {
      let name: string | null = null
      if (client) {
        try {
          // Roles are guild-scoped, try every guild cache and fetch
          for (const [, guild] of client.guilds.cache) {
            let role = guild.roles.cache.get(id)
            if (!role) {
              try {
                const fetched = await guild.roles.fetch(id)
                if (fetched) role = fetched
              } catch {
                // not in this guild
              }
            }
            if (role) {
              name = role.name
              break
            }
          }
        } catch {
          // not resolvable
        }
      }
      resolvedRoles.push({ id, name })
    }

    const availableLanguages = Object.values(ApplicationLanguages)

    // Fetch guild ranks for rankup editor
    let guildRanks: string[] = []
    const instances = this.application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
    if (instances.length > 0) {
      const botInstanceName = instances[0]
      const mcInstance = this.application.minecraftManager
        .getAllInstances()
        .find((inst) => inst.instanceName.toLowerCase() === botInstanceName.toLowerCase())
      const botUuid = mcInstance?.uuid()
      if (botUuid) {
        try {
          const guild = await this.application.hypixelApi.getGuild('player', botUuid, {})
          if (guild) guildRanks = guild.ranks.map((r) => r.name)
        } catch {
          // fail gracefully
        }
      }
    }

    sendSuccess(response, {
      bridgeId,
      channels: resolvedChannels,
      roles: resolvedRoles,
      availableLanguages,
      guildRanks,
      categories
    })
  }

  private async handlePut(
    response: http.ServerResponse,
    bridgeId: string,
    category: string,
    body: SettingObject
  ): Promise<void> {
    const ids = this.application.core.bridgeConfigurations.getAllBridgeIds()
    if (!ids.includes(bridgeId)) {
      sendError(response, 'NOT_FOUND', 'Bridge not found', 404)
      return
    }

    const cfg = this.application.core.bridgeConfigurations

    try {
      switch (category) {
        case 'channels':
          cfg.setPublicChannelIds(bridgeId, arr(body.publicChannelIds))
          cfg.setOfficerChannelIds(bridgeId, arr(body.officerChannelIds))
          cfg.setLoggerChannelIds(bridgeId, arr(body.loggerChannelIds))
          cfg.setPromoteChannelIds(bridgeId, arr(body.promoteChannelIds))
          break
        case 'instances':
          cfg.setMinecraftInstances(bridgeId, arr(body.minecraftInstances))
          break
        case 'staffRoles':
          cfg.setHelperRoleIds(bridgeId, arr(body.helperRoleIds))
          cfg.setOwnerRoleIds(bridgeId, arr(body.ownerRoleIds))
          break
        case 'discordSettings':
          cfg.setAlwaysReplyReaction(bridgeId, bool(body.alwaysReply))
          cfg.setEnforceVerification(bridgeId, bool(body.enforceVerification))
          cfg.setTextToImage(bridgeId, bool(body.minecraftTextImages))
          void cfg.setLanguage(bridgeId, str(body.language) || undefined)
          break
        case 'minecraftEvents': {
          cfg.setGuildOnline(bridgeId, bool(body.memberOnline))
          cfg.setGuildOffline(bridgeId, bool(body.memberOffline))
          cfg.setPersistGuildOnlineOffline(bridgeId, bool(body.persistOnlineOffline))
          const deleteAfter = num(body.deleteAfterSeconds, 300)
          cfg.setDurationTemporarilyInteractions(bridgeId, Duration.seconds(deleteAfter))
          cfg.setMaxTemporarilyInteractions(bridgeId, num(body.maxEvents, 10))
          cfg.setRandomChatterEnabled(bridgeId, bool(body.chatterEnabled))
          cfg.setRandomChatterIntervalMinutes(bridgeId, num(body.chatterIntervalMinutes, 15))
          cfg.setRandomChatterMinimumOnlinePlayers(bridgeId, num(body.chatterMinOnlinePlayers, 1))
          cfg.setRandomChatterIncludePlayerName(bridgeId, bool(body.chatterUseBotName))
          cfg.setRandomChatterMessages(bridgeId, arr(body.chatterMessages))
          cfg.setRandomChatterAntiRepeatLength(bridgeId, num(body.chatterAntiRepeatLength, 5))
          cfg.setRandomChatterQuietWindowMinutes(bridgeId, num(body.chatterQuietWindowMinutes, 2))
          break
        }
        case 'skyblockEvents': {
          cfg.setSkyblockEventsEnabled(bridgeId, bool(body.enabled))
          cfg.setDarkAuctionReminder(bridgeId, bool(body.darkAuctionReminder))
          cfg.setStarfallCultReminder(bridgeId, bool(body.starfallCultReminder))
          const eventToggles = body.events as Record<string, boolean> | undefined
          if (eventToggles) {
            for (const [key, value] of Object.entries(eventToggles)) {
              cfg.setSkyblockEventNotifier(bridgeId, key, bool(value))
            }
          }
          break
        }
        case 'qualityOfLife':
          cfg.setJoinGuildReaction(bridgeId, bool(body.guildJoinReaction))
          cfg.setLeaveGuildReaction(bridgeId, bool(body.guildLeaveReaction))
          cfg.setKickGuildReaction(bridgeId, bool(body.guildKickReaction))
          cfg.setJoinReactionEmojiType(bridgeId, str(body.joinDiscordReaction, 'none'))
          cfg.setLeaveReactionEmojiType(bridgeId, str(body.leaveDiscordReaction, 'none'))
          cfg.setAnnounceMutedPlayer(bridgeId, bool(body.announcePlayerMuted))
          break
        case 'customMessages':
          cfg.setGuildJoinReactionMessages(bridgeId, arr(body.joinMessages))
          cfg.setGuildLeaveReactionMessages(bridgeId, arr(body.leaveMessages))
          cfg.setGuildKickReactionMessages(bridgeId, arr(body.kickMessages))
          cfg.setDarkAuctionReminderMessage(bridgeId, str(body.darkAuctionReminderText))
          cfg.setStarfallReminderMessage(bridgeId, str(body.starfallCultReminderText))
          cfg.setAnnounceMutedPlayerMessage(bridgeId, str(body.announcePlayerMutedText))
          break
        case 'moderation':
          cfg.setHeatPunishmentEnabled(bridgeId, boolOrUndefined(body.heatPunishmentsEnabled))
          cfg.setKicksPerDay(bridgeId, body.heatKicksPerDay != null ? num(body.heatKicksPerDay) : undefined)
          cfg.setMutesPerDay(bridgeId, body.heatMutesPerDay != null ? num(body.heatMutesPerDay) : undefined)
          cfg.setImmuneDiscordUsers(bridgeId, arr(body.immuneDiscordUserIds))
          cfg.setImmuneMojangPlayers(bridgeId, arr(body.immuneMojangPlayers))
          cfg.setProfanityEnabled(bridgeId, boolOrUndefined(body.profanityFilterEnabled))
          break
        case 'chatCommands':
          cfg.setCommandsEnabled(bridgeId, boolOrUndefined(body.commandsEnabled))
          cfg.setCommandPrefix(bridgeId, str(body.chatCommandPrefix) || undefined)
          cfg.setPassthroughPrefix(bridgeId, str(body.passthroughPrefix) || undefined)
          cfg.setPassthroughCommands(bridgeId, arr(body.passthroughCommands))
          cfg.setInsultMode(bridgeId, str(body.insultMode) || undefined)
          break
        case 'rankup':
          cfg.setRankupEnabled(bridgeId, bool(body.enabled))
          cfg.setRankupManualReview(bridgeId, bool(body.manualReview))
          cfg.setRankupNotificationCooldown(bridgeId, num(body.notificationCooldown))
          cfg.setRankupNotificationChannelIds(bridgeId, arr(body.notificationChannelIds))
          cfg.setRankupRules(bridgeId, body.promotionRules as never)
          cfg.setRankupDemotionRules(bridgeId, body.demotionRules as never)
          cfg.setRankupExcludedRanks(bridgeId, arr(body.excludedRanks))
          cfg.setRankupExcludedPlayers(bridgeId, arr(body.excludedPlayers))
          break
        default:
          sendError(response, 'NOT_FOUND', `Unknown category: ${category}`, 404)
          return
      }

      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to save settings for bridge %s category %s:', bridgeId, category, error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to save settings', 500)
    }
  }

  private async handleCreateBridge(response: http.ServerResponse, body: { bridgeId?: unknown }): Promise<void> {
    const rawId = body?.bridgeId
    if (typeof rawId !== 'string' || rawId.trim().length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid bridgeId', 400)
      return
    }

    const bridgeId = rawId.trim().toLowerCase()
    if (bridgeId.length > 32) {
      sendError(response, 'VALIDATION_ERROR', 'bridgeId must be 32 characters or less', 400)
      return
    }

    if (!/^[a-z0-9_-]+$/.test(bridgeId)) {
      sendError(
        response,
        'VALIDATION_ERROR',
        'bridgeId can only contain lowercase letters, numbers, hyphens, and underscores',
        400
      )
      return
    }

    const existing = this.application.core.bridgeConfigurations.getAllBridgeIds()
    if (existing.includes(bridgeId)) {
      sendError(response, 'CONFLICT', `Bridge "${bridgeId}" already exists`, 409)
      return
    }

    this.application.core.bridgeConfigurations.addBridgeId(bridgeId)
    await this.application.bridgeResolver.rebuildLookupMaps()

    sendSuccess(response, { success: true, bridgeId })
  }

  private async handleDelete(response: http.ServerResponse, bridgeId: string): Promise<void> {
    const ids = this.application.core.bridgeConfigurations.getAllBridgeIds()
    if (!ids.includes(bridgeId)) {
      sendError(response, 'NOT_FOUND', 'Bridge not found', 404)
      return
    }

    this.application.core.bridgeConfigurations.removeBridgeId(bridgeId)
    await this.application.bridgeResolver.rebuildLookupMaps()
    sendSuccess(response, { success: true })
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
      sendError(response, 'INTERNAL_ERROR', 'Failed to read request body', 400)
      return undefined
    }

    if (raw.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing request body', 400)
      return undefined
    }

    try {
      return JSON.parse(raw)
    } catch (error: unknown) {
      this.logger.warn('Invalid JSON body', error)
      sendError(response, 'VALIDATION_ERROR', 'Invalid JSON body', 400)
      return undefined
    }
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
}
