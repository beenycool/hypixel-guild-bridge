import type http from 'node:http'

import { EmbedBuilder } from 'discord.js'
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Color, Permission } from '../../common/application-event.js'
import type { InactivityEntry } from '../../core/users/inactivity.js'

import { sendError, sendSuccess } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

const InactivityPrefix = '/api/inactivity'
const ConfigKey = 'inactivity_config'

interface InactivityAppConfig {
  enabled: boolean
  channelIds: string[]
}

const defaultConfig: InactivityAppConfig = { enabled: true, channelIds: [] }

export class InactivityApiHandler {
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
    const result = verifyToken(buildTokenSet(webConfig), request.headers.authorization)
    if (!result.ok) {
      sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
      return undefined
    }
    return { permission: result.permission, userId: result.userId }
  }

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart.startsWith(InactivityPrefix)) return false

    const method = request.method ?? 'GET'

    const auth = this.verifyAuth(request, response)
    if (auth === undefined) return true

    if (method === 'GET' && pathPart === `${InactivityPrefix}/config`) {
      if (auth.permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleGetConfig(response)
      return true
    }

    if (method === 'PUT' && pathPart === `${InactivityPrefix}/config`) {
      if (auth.permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handlePutConfig(request, response)
      return true
    }

    if (method === 'GET' && pathPart === InactivityPrefix) {
      if (auth.permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleList(response)
      return true
    }

    if (method === 'POST' && pathPart === InactivityPrefix) {
      await this.handleCreate(request, response, auth.userId)
      return true
    }

    if (method === 'POST') {
      const approveMatch = /^\/api\/inactivity\/([^/]+)\/approve$/.exec(pathPart)
      if (approveMatch) {
        if (auth.permission < Permission.Helper) {
          sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
          return true
        }
        await this.handleApprove(approveMatch[1], response, auth.userId)
        return true
      }

      const rejectMatch = /^\/api\/inactivity\/([^/]+)\/reject$/.exec(pathPart)
      if (rejectMatch) {
        if (auth.permission < Permission.Helper) {
          sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
          return true
        }
        await this.handleReject(rejectMatch[1], response, auth.userId)
        return true
      }
    }

    this.sendMethodNotAllowed(response, ['GET', 'POST', 'PUT'])
    return true
  }

  private async handleGetConfig(response: http.ServerResponse): Promise<void> {
    try {
      const config = await this.loadConfig()
      sendSuccess(response, config)
    } catch (error: unknown) {
      this.logger.error('Failed to load inactivity config', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to load inactivity config', 500)
    }
  }

  private async handlePutConfig(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const { enabled, channelIds } = body as {
      enabled?: unknown
      channelIds?: unknown
    }

    const config: InactivityAppConfig = {
      enabled: typeof enabled === 'boolean' ? enabled : defaultConfig.enabled,
      channelIds: Array.isArray(channelIds)
        ? channelIds.filter((id): id is string => typeof id === 'string')
        : defaultConfig.channelIds
    }

    try {
      await this.saveConfig(config)
      sendSuccess(response, config)
    } catch (error: unknown) {
      this.logger.error('Failed to save inactivity config', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to save inactivity config', 500)
    }
  }

  private async loadConfig(): Promise<InactivityAppConfig> {
    try {
      const row = await this.application.core.databaseManager.queryOne<{ value: string }>(
        `SELECT "value" FROM "app_settings" WHERE "key" = $1`,
        [ConfigKey]
      )
      if (!row) return { ...defaultConfig }
      return { ...defaultConfig, ...(JSON.parse(row.value) as Partial<InactivityAppConfig>) }
    } catch {
      return { ...defaultConfig }
    }
  }

  private async saveConfig(config: InactivityAppConfig): Promise<void> {
    await this.application.core.databaseManager.execute(
      `INSERT INTO "app_settings" ("key", "value", "updated_at") VALUES ($1, $2, NOW())
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW()`,
      [ConfigKey, JSON.stringify(config)]
    )
  }

  private async handleList(response: http.ServerResponse): Promise<void> {
    try {
      const entries: InactivityEntry[] = this.application.core.inactivity.getAllActive()
      const requests = await Promise.all(
        entries.map(async (entry) => {
          let name: string | undefined
          try {
            const profile = await this.application.mojangApi.profileByUuid(entry.uuid)
            name = profile.name
          } catch {
            // not resolvable
          }
          return {
            id: entry.uuid,
            uuid: entry.uuid,
            discordId: entry.discordId,
            name,
            username: name,
            reason: entry.reason,
            status: 'pending',
            createdAt: entry.createdAt * 1000,
            expiresAt: entry.expiresAt * 1000,
            durationDays: Math.round((entry.expiresAt - entry.createdAt) / 86_400)
          }
        })
      )
      sendSuccess(response, { requests })
    } catch (error: unknown) {
      this.logger.error('Failed to list inactivity entries', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to list inactivity entries', 500)
    }
  }

  private async handleCreate(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    userId: string | undefined
  ): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const { username, reason, durationDays } = body as {
      username?: unknown
      reason?: unknown
      durationDays?: unknown
    }

    if (typeof username !== 'string' || username.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid username', 400)
      return
    }
    if (typeof reason !== 'string' || reason.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid reason', 400)
      return
    }
    if (typeof durationDays !== 'number' || !Number.isFinite(durationDays) || durationDays < 1) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid durationDays', 400)
      return
    }

    let uuid: string
    try {
      const profile = await this.application.mojangApi.profileByUsername(username)
      uuid = profile.id
    } catch {
      sendError(response, 'VALIDATION_ERROR', 'Could not resolve Minecraft username', 400)
      return
    }

    const discordId = userId ?? ''
    const expiresAt = Math.floor(Date.now() / 1000) + durationDays * 86_400

    try {
      this.application.core.inactivity.add({
        uuid,
        discordId,
        reason,
        expiresAt
      })
      sendSuccess(response, { success: true })
      await this.sendDiscordNotification('created', {
        uuid,
        username,
        reason,
        durationDays,
        discordId
      })
    } catch (error: unknown) {
      this.logger.error('Failed to create inactivity entry', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to create inactivity entry', 500)
    }
  }

  private async handleApprove(uuid: string, response: http.ServerResponse, userId: string | undefined): Promise<void> {
    const entry = this.application.core.inactivity.getActiveByUuid(uuid)
    if (!entry) {
      sendError(response, 'NOT_FOUND', 'Inactivity request not found', 404)
      return
    }
    this.application.core.inactivity.removeByUuid(uuid)
    sendSuccess(response, { success: true })
    await this.sendDiscordNotification('approved', {
      entry,
      userId
    })
  }

  private async handleReject(uuid: string, response: http.ServerResponse, userId: string | undefined): Promise<void> {
    const entry = this.application.core.inactivity.getActiveByUuid(uuid)
    if (!entry) {
      sendError(response, 'NOT_FOUND', 'Inactivity request not found', 404)
      return
    }
    this.application.core.inactivity.removeByUuid(uuid)
    sendSuccess(response, { success: true })
    await this.sendDiscordNotification('rejected', {
      entry,
      userId
    })
  }

  private async sendDiscordNotification(
    action: 'created' | 'approved' | 'rejected',
    context: {
      uuid?: string
      username?: string
      reason?: string
      durationDays?: number
      discordId?: string
      entry?: InactivityEntry
      userId?: string
    }
  ): Promise<void> {
    try {
      const config = await this.loadConfig()
      if (!config.enabled || config.channelIds.length === 0) return

      const discordClient = this.application.discordInstance.getClient()
      if (!discordClient.isReady()) return

      let playerName: string
      let reason: string
      let durationLabel: string
      let createdBy = 'Web UI'

      if (action === 'created' && context.uuid && context.username) {
        playerName = context.username
        reason = context.reason ?? 'No reason'
        durationLabel = this.formatDuration(context.durationDays ?? 0)
        if (context.discordId) {
          try {
            const user = await discordClient.users.fetch(context.discordId)
            createdBy = user.displayName
          } catch {
            createdBy = context.discordId
          }
        }
      } else if (context.entry) {
        try {
          const profile = await this.application.mojangApi.profileByUuid(context.entry.uuid)
          playerName = profile.name
        } catch {
          playerName = context.entry.uuid
        }
        reason = context.entry.reason
        durationLabel = this.formatDuration(Math.round((context.entry.expiresAt - context.entry.createdAt) / 86_400))
        if (context.userId) {
          try {
            const user = await discordClient.users.fetch(context.userId)
            createdBy = user.displayName
          } catch {
            createdBy = context.userId
          }
        }
      } else {
        return
      }

      const actionLabel = action === 'created' ? 'Submitted' : action === 'approved' ? 'Approved' : 'Rejected'
      const color = action === 'created' ? Color.Info : action === 'approved' ? Color.Good : Color.Bad
      const emoji = action === 'created' ? '\uD83D\uDCCB' : action === 'approved' ? '\u2705' : '\u274C'

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji} Inactivity ${actionLabel}`)
        .addFields(
          { name: 'Player', value: playerName, inline: true },
          { name: 'Reason', value: reason, inline: true },
          { name: 'Duration', value: durationLabel, inline: true },
          { name: 'By', value: createdBy, inline: true }
        )
        .setTimestamp()

      for (const channelId of config.channelIds) {
        try {
          const channel = await discordClient.channels.fetch(channelId)
          if (!channel?.isSendable()) continue
          await channel.send({ embeds: [embed] })
        } catch (error: unknown) {
          this.logger.warn(`Failed to send inactivity notification to channel ${channelId}`, error)
        }
      }
    } catch (error: unknown) {
      this.logger.warn('Failed to send inactivity Discord notification', error)
    }
  }

  private formatDuration(days: number): string {
    if (days >= 30) {
      const months = Math.floor(days / 30)
      const remainingDays = days % 30
      return remainingDays > 0 ? `${months}mo ${remainingDays}d` : `${months}mo`
    }
    return `${days}d`
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

  private sendMethodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '))
    sendError(response, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405)
  }
}
