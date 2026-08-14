import type http from 'node:http'

import type { Logger } from 'log4js'

import EnglishTranslations from '../../../resources/locales/en.json'
import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'
import { ApplicationLanguages } from '../../core/language-configurations.js'
import Duration from '../../utility/duration.js'

import { sendError, sendSuccess } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

type Primitive = boolean | number | string
type SettingObject = Record<string, Primitive | Primitive[] | Record<string, Primitive> | undefined>

const PREFIX = '/api/bridges'

function stringValue(s: unknown, d = ''): string {
  if (typeof s === 'string') return s
  if (s === undefined || s === null) return d
  return String(s as string | number | boolean)
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

function numberValue(s: unknown, d = 0): number {
  if (typeof s === 'number' && Number.isFinite(s)) return s
  if (typeof s === 'string') {
    const n = Number(s)
    return Number.isFinite(n) ? n : d
  }
  return d
}

function array(s: unknown): string[] {
  if (Array.isArray(s)) return s.map(String)
  if (typeof s === 'string') {
    try {
      const p = JSON.parse(s) as unknown
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
    if (!pathPart.startsWith(PREFIX)) return false

    const method = (request.method ?? 'GET').toUpperCase()
    const segments = pathPart
      .slice(PREFIX.length + 1)
      .split('/')
      .filter(Boolean)

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    // GET /api/bridges (list all bridges)
    if (method === 'GET' && segments.length === 0) {
      this.handleBridgesList(response)
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
      this.handleCreateBridge(response, body as { bridgeId?: unknown })
      return true
    }

    // GET /api/bridges/:bridgeId (get bridge details)
    if (method === 'GET' && segments.length === 1) {
      if (permission < Permission.Owner) {
        sendError(response, 'FORBIDDEN', 'Forbidden', 403)
        return true
      }
      this.handleBridgeGet(response, segments[0])
      return true
    }

    // DELETE /api/bridges/:bridgeId
    if (method === 'DELETE' && segments.length === 1) {
      if (permission < Permission.Admin) {
        sendError(response, 'FORBIDDEN', 'Forbidden', 403)
        return true
      }
      this.handleDelete(response, segments[0])
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
      this.handlePut(response, segments[0], segments[2], body as SettingObject)
      return true
    }

    sendError(response, 'NOT_FOUND', 'Not found', 404)
    return true
  }

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

  private handleBridgesList(response: http.ServerResponse): void {
    try {
      const bridgeConfigurations = this.application.core.bridgeConfigurations
      const bridgeIds = bridgeConfigurations.getAllBridgeIds()
      const bridges = bridgeIds.map((id) => {
        const settings = bridgeConfigurations.getAllSettings(id)
        return { id, ...settings }
      })
      sendSuccess(response, bridges)
    } catch (error: unknown) {
      sendError(response, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Failed to list bridges', 500)
    }
  }

  private handleBridgeGet(response: http.ServerResponse, bridgeId: string): void {
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
    for (const id of array((categories.channels as SettingObject | undefined)?.publicChannelIds)) channelIds.add(id)
    for (const id of array((categories.channels as SettingObject | undefined)?.officerChannelIds)) channelIds.add(id)
    for (const id of array((categories.channels as SettingObject | undefined)?.loggerChannelIds)) channelIds.add(id)
    for (const id of array((categories.channels as SettingObject | undefined)?.promoteChannelIds)) channelIds.add(id)
    for (const id of array((categories.channels as SettingObject | undefined)?.chatSummaryChannelIds))
      channelIds.add(id)
    for (const id of array((categories.rankup as SettingObject | undefined)?.notificationChannelIds)) channelIds.add(id)
    for (const id of array((categories.statsChannels as SettingObject | undefined)?.channelIds)) channelIds.add(id)

    // Collect role IDs for name resolution
    const roleIds = new Set<string>()
    for (const id of array((categories.staffRoles as SettingObject | undefined)?.helperRoleIds)) roleIds.add(id)
    for (const id of array((categories.staffRoles as SettingObject | undefined)?.officerRoleIds)) roleIds.add(id)
    for (const id of array((categories.staffRoles as SettingObject | undefined)?.ownerRoleIds)) roleIds.add(id)
    for (const id of array((categories.staffRoles as SettingObject | undefined)?.joinRequestRoleIds)) roleIds.add(id)

    const resolvedChannels: { id: string; name: string | undefined }[] = []
    const client = this.application.discordInstance.getClient()
    for (const id of channelIds) {
      let name: string | undefined
      try {
        const ch = await client.channels.fetch(id).catch(() => undefined)
        if (ch && 'name' in ch) name = (ch as { name: string }).name
      } catch {
        // not resolvable
      }
      resolvedChannels.push({ id, name })
    }

    const resolvedRoles: { id: string; name: string | undefined }[] = []
    for (const id of roleIds) {
      let name: string | undefined
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
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- getGuild('player', ...) returns null at runtime for players without a guild despite the Promise<Guild> typing
          if (guild) guildRanks = guild.ranks.map((r) => r.name)
        } catch {
          // fail gracefully
        }
      }
    }

    const config = this.application.core.bridgeConfigurations
    const translationDefaults: Record<string, string> = {}
    for (const [key, value] of Object.entries(EnglishTranslations)) {
      if (typeof value === 'string') {
        translationDefaults[key] = value
      }
      if (Array.isArray(value)) {
        translationDefaults[key] = JSON.stringify(value)
      }
    }
    const overrides = config.getTranslationOverrides(bridgeId)

    sendSuccess(response, {
      bridgeId,
      channels: resolvedChannels,
      roles: resolvedRoles,
      availableLanguages,
      guildRanks,
      categories,
      translationKeys: Object.keys(EnglishTranslations),
      translationDefaults,
      translationOverrides: overrides
    })
  }

  private handlePut(response: http.ServerResponse, bridgeId: string, category: string, body: SettingObject): void {
    const ids = this.application.core.bridgeConfigurations.getAllBridgeIds()
    if (!ids.includes(bridgeId)) {
      sendError(response, 'NOT_FOUND', 'Bridge not found', 404)
      return
    }

    const cfg = this.application.core.bridgeConfigurations

    try {
      switch (category) {
        case 'channels': {
          cfg.setPublicChannelIds(bridgeId, array(body.publicChannelIds))
          cfg.setOfficerChannelIds(bridgeId, array(body.officerChannelIds))
          cfg.setLoggerChannelIds(bridgeId, array(body.loggerChannelIds))
          cfg.setPromoteChannelIds(bridgeId, array(body.promoteChannelIds))
          cfg.setChatSummaryChannelIds(bridgeId, array(body.chatSummaryChannelIds))
          cfg.setChatSummaryEnabled(bridgeId, bool(body.chatSummaryEnabled))
          break
        }
        case 'instances': {
          cfg.setMinecraftInstances(bridgeId, array(body.minecraftInstances))
          break
        }
        case 'staffRoles': {
          cfg.setHelperRoleIds(bridgeId, array(body.helperRoleIds))
          cfg.setOfficerRoleIds(bridgeId, array(body.officerRoleIds))
          cfg.setOwnerRoleIds(bridgeId, array(body.ownerRoleIds))
          cfg.setJoinRequestRoleIds(bridgeId, array(body.joinRequestRoleIds))
          break
        }
        case 'discordSettings': {
          cfg.setAlwaysReplyReaction(bridgeId, bool(body.alwaysReply))
          cfg.setEnforceVerification(bridgeId, bool(body.enforceVerification))
          cfg.setTextToImage(bridgeId, bool(body.minecraftTextImages))
          cfg.setLanguage(bridgeId, stringValue(body.language) || undefined)
          cfg.setBotUsernameOverride(bridgeId, stringValue(body.botUsernameOverride) || undefined)
          break
        }
        case 'minecraftEvents': {
          cfg.setGuildOnline(bridgeId, bool(body.memberOnline))
          cfg.setGuildOffline(bridgeId, bool(body.memberOffline))
          cfg.setPersistGuildOnlineOffline(bridgeId, bool(body.persistOnlineOffline))
          const deleteAfter = numberValue(body.deleteAfterSeconds, 300)
          cfg.setDurationTemporarilyInteractions(bridgeId, Duration.seconds(deleteAfter))
          cfg.setMaxTemporarilyInteractions(bridgeId, numberValue(body.maxEvents, 10))
          cfg.setPersistGuildJoinLeave(bridgeId, bool(body.persistJoinLeave))
          const deleteJoinLeaveAfter = Math.max(
            86_400,
            Math.min(604_800, numberValue(body.deleteJoinLeaveAfterSeconds, 172_800))
          ) // 2 days in seconds, clamped to 1-7 days
          cfg.setDurationJoinLeaveInteractions(bridgeId, Duration.seconds(deleteJoinLeaveAfter))
          cfg.setRandomChatterEnabled(bridgeId, bool(body.chatterEnabled))
          cfg.setRandomChatterIntervalMinutes(bridgeId, numberValue(body.chatterIntervalMinutes, 15))
          cfg.setRandomChatterMinimumOnlinePlayers(bridgeId, numberValue(body.chatterMinOnlinePlayers, 1))
          cfg.setRandomChatterIncludePlayerName(bridgeId, bool(body.chatterUseBotName))
          cfg.setRandomChatterMessages(bridgeId, array(body.chatterMessages))
          cfg.setRandomChatterAntiRepeatLength(bridgeId, numberValue(body.chatterAntiRepeatLength, 5))
          cfg.setRandomChatterQuietWindowMinutes(bridgeId, numberValue(body.chatterQuietWindowMinutes, 2))
          cfg.setWelcomeOnlineEnabled(bridgeId, bool(body.welcomeOnlineEnabled))
          cfg.setWelcomeOnlineMessages(
            bridgeId,
            (body.welcomeOnlineMessages as never as { uuid: string; message: string }[] | undefined) ?? []
          )
          break
        }
        case 'qualityOfLife': {
          cfg.setJoinGuildReaction(bridgeId, bool(body.guildJoinReaction))
          cfg.setLeaveGuildReaction(bridgeId, bool(body.guildLeaveReaction))
          cfg.setKickGuildReaction(bridgeId, bool(body.guildKickReaction))
          cfg.setJoinReactionEmojiType(bridgeId, stringValue(body.joinDiscordReaction, 'none'))
          cfg.setLeaveReactionEmojiType(bridgeId, stringValue(body.leaveDiscordReaction, 'none'))
          cfg.setAnnounceMutedPlayer(bridgeId, bool(body.announcePlayerMuted))
          break
        }
        case 'moderation': {
          cfg.setHeatPunishmentEnabled(bridgeId, boolOrUndefined(body.heatPunishmentsEnabled))
          cfg.setKicksPerDay(
            bridgeId,
            body.heatKicksPerDay == undefined ? undefined : numberValue(body.heatKicksPerDay)
          )
          cfg.setMutesPerDay(
            bridgeId,
            body.heatMutesPerDay == undefined ? undefined : numberValue(body.heatMutesPerDay)
          )
          cfg.setImmuneDiscordUsers(bridgeId, array(body.immuneDiscordUserIds))
          cfg.setImmuneMojangPlayers(bridgeId, array(body.immuneMojangPlayers))
          cfg.setProfanityEnabled(bridgeId, boolOrUndefined(body.profanityFilterEnabled))
          break
        }
        case 'chatCommands': {
          cfg.setCommandsEnabled(bridgeId, boolOrUndefined(body.commandsEnabled))
          cfg.setCommandPrefix(bridgeId, stringValue(body.chatCommandPrefix) || undefined)
          cfg.setPassthroughPrefix(bridgeId, stringValue(body.passthroughPrefix) || undefined)
          cfg.setPassthroughCommands(bridgeId, array(body.passthroughCommands))
          cfg.setInsultMode(bridgeId, stringValue(body.insultMode) || undefined)
          break
        }
        case 'rankup': {
          cfg.setRankupEnabled(bridgeId, bool(body.enabled))
          cfg.setRankupManualReview(bridgeId, bool(body.manualReview))
          cfg.setRankupNotificationCooldown(bridgeId, numberValue(body.notificationCooldown))
          cfg.setRankupNotificationChannelIds(bridgeId, array(body.notificationChannelIds))
          cfg.setRankupPingUserIds(bridgeId, array(body.pingUserIds))
          if (body.scheduleDay !== undefined) {
            cfg.setRankupScheduleDay(bridgeId, numberValue(body.scheduleDay, -1))
          }
          if (body.scheduleHour !== undefined) {
            cfg.setRankupScheduleHour(bridgeId, numberValue(body.scheduleHour, -1))
          }
          cfg.setRankupRules(bridgeId, body.promotionRules as never)
          cfg.setRankupDemotionRules(bridgeId, body.demotionRules as never)
          cfg.setRankupExcludedRanks(bridgeId, array(body.excludedRanks))
          cfg.setRankupExcludedPlayers(bridgeId, array(body.excludedPlayers))
          break
        }
        case 'translations': {
          const overrides = body.overrides as Record<string, string> | undefined
          if (overrides !== undefined) {
            cfg.setTranslationOverrides(bridgeId, overrides)
          }
          break
        }
        case 'tournament': {
          cfg.setTournamentEnabled(bridgeId, bool(body.enabled))
          cfg.setTournamentNotificationChannelId(bridgeId, stringValue(body.notificationChannelId))
          cfg.setTournamentDefaultDeadlineHours(bridgeId, numberValue(body.defaultDeadlineHours, 48))
          cfg.setTournamentDefaultBestOf(bridgeId, numberValue(body.defaultBestOf, 1))
          cfg.setTournamentAnnounceMc(bridgeId, bool(body.announceMc))
          cfg.setTournamentCheckinWindowMinutes(bridgeId, numberValue(body.checkinWindowMinutes, 60))
          cfg.setTournamentMinParticipants(bridgeId, numberValue(body.minParticipants, 4))
          cfg.setTournamentMaxExtensionHours(bridgeId, numberValue(body.maxExtensionHours, 24))
          cfg.setTournamentAutoCheckin(bridgeId, bool(body.autoCheckin))
          cfg.setTournamentCategoryId(bridgeId, stringValue(body.categoryId) || undefined)
          cfg.setTournamentDefaultBracketFormat(bridgeId, stringValue(body.bracketFormat, 'single-elim'))
          cfg.setTournamentValidGameTypes(bridgeId, array(body.validGameTypes))
          break
        }
        case 'statsChannels': {
          cfg.setStatsTopicEnabled(bridgeId, bool(body.enabled))
          cfg.setStatsTopicTemplate(bridgeId, stringValue(body.template) || undefined)
          cfg.setStatsTopicChannelIds(bridgeId, array(body.channelIds))
          cfg.setStatsTopicUpdateIntervalMinutes(bridgeId, numberValue(body.updateIntervalMinutes, 5))
          break
        }
        case 'interview': {
          cfg.setInterviewEnabled(bridgeId, bool(body.enabled))
          cfg.setInterviewQuestion(bridgeId, stringValue(body.question) || undefined)
          cfg.setInterviewTimeoutMs(bridgeId, numberValue(body.timeoutMs, 600_000))
          break
        }
        default: {
          sendError(response, 'NOT_FOUND', `Unknown category: ${category}`, 404)
          return
        }
      }

      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to save settings for bridge %s category %s:', bridgeId, category, error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to save settings', 500)
    }
  }

  private handleCreateBridge(response: http.ServerResponse, body: { bridgeId?: unknown } | null | undefined): void {
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
    this.application.bridgeResolver.rebuildLookupMaps()

    sendSuccess(response, { success: true, bridgeId })
  }

  private handleDelete(response: http.ServerResponse, bridgeId: string): void {
    const ids = this.application.core.bridgeConfigurations.getAllBridgeIds()
    if (!ids.includes(bridgeId)) {
      sendError(response, 'NOT_FOUND', 'Bridge not found', 404)
      return
    }

    this.application.core.bridgeConfigurations.removeBridgeId(bridgeId)
    this.application.bridgeResolver.rebuildLookupMaps()
    sendSuccess(response, { success: true })
  }

  private async readJsonBody(request: http.IncomingMessage, response: http.ServerResponse): Promise<unknown> {
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
