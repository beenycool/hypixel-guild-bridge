import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { type InstanceType, MinecraftSendChatPriority, Permission } from '../../common/application-event.js'
import { Status } from '../../common/connectable-instance.js'
import type EventHelper from '../../common/event-helper.js'
import { checkChatTriggers, InviteAcceptChat, RankChat } from '../../utility/chat-triggers.js'

import { sendError, sendSuccess } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

const GuildPrefix = '/api/guild'

export class GuildApiHandler {
  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  private verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): Permission | undefined {
    const webConfig = this.application.config.web
    if (!webConfig?.signingSecret) return undefined
    const result = verifyToken(buildTokenSet(webConfig), request.headers.authorization)
    if (!result.ok) {
      sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
      return undefined
    }
    return result.permission
  }

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart.startsWith(GuildPrefix)) return false

    const method = request.method ?? 'GET'

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    // GET /api/guild/overview
    if (pathPart === `${GuildPrefix}/overview`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleOverview(response)
      return true
    }

    // GET /api/guild/members
    if (pathPart === `${GuildPrefix}/members`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleMembers(response)
      return true
    }

    // GET /api/guild/log
    if (pathPart === `${GuildPrefix}/log`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      await this.handleLog(response)
      return true
    }

    // POST /api/guild/member/accept
    if (pathPart === `${GuildPrefix}/member/accept`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleMemberAccept(request, response)
      return true
    }

    // POST /api/guild/member/invite
    if (pathPart === `${GuildPrefix}/member/invite`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleMemberInvite(request, response)
      return true
    }

    // POST /api/guild/member/promote
    if (pathPart === `${GuildPrefix}/member/promote`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleMemberPromote(request, response)
      return true
    }

    // POST /api/guild/member/demote
    if (pathPart === `${GuildPrefix}/member/demote`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleMemberDemote(request, response)
      return true
    }

    // POST /api/guild/member/setrank
    if (pathPart === `${GuildPrefix}/member/setrank`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleMemberSetrank(request, response)
      return true
    }

    // POST /api/guild/blacklist
    if (pathPart === `${GuildPrefix}/blacklist`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleBlacklist(request, response)
      return true
    }

    return false
  }

  private getInstanceName(): string | undefined {
    const allInstances = this.application.minecraftManager.getAllInstances()
    const connected = allInstances.find((inst) => inst.currentStatus() === Status.Connected)
    return connected?.instanceName
  }

  private async handleOverview(response: http.ServerResponse): Promise<void> {
    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    try {
      const guild = await this.application.hypixelApi.getGuild('player', instance, {})
      const weeklyGexp = guild.members.reduce((sum, m) => sum + m.weeklyExperience, 0)
      sendSuccess(response, {
        name: guild.name,
        memberCount: guild.members.length,
        weeklyGexp,
        ranks: guild.ranks.map((r) => ({ name: r.name, priority: r.priority })),
        createdAt: guild.createdAt.getTime()
      })
    } catch (error: unknown) {
      this.logger.error('Failed to fetch guild overview', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to fetch guild data', 502)
    }
  }

  private async handleMembers(response: http.ServerResponse): Promise<void> {
    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    try {
      const guild = await this.application.hypixelApi.getGuild('player', instance, {})
      const members = await Promise.all(
        guild.members.map(async (m) => {
          let name = m.uuid
          try {
            const profile = await this.application.mojangApi.profileByUuid(m.uuid)
            name = profile.name
          } catch {
            // keep uuid as name
          }
          return {
            uuid: m.uuid,
            name,
            rank: m.rank,
            joinedAt: m.joinedAt.getTime(),
            weeklyGexp: m.weeklyExperience
          }
        })
      )
      sendSuccess(response, { members })
    } catch (error: unknown) {
      this.logger.error('Failed to fetch guild members', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to fetch guild members', 502)
    }
  }

  private async handleLog(response: http.ServerResponse): Promise<void> {
    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    try {
      const log: { message: string; instanceName: string }[] = []
      const timeout = 10_000

      this.application
        .sendMinecraft([instance], MinecraftSendChatPriority.High, undefined, '/guild log')
        .catch((error: unknown) => {
          this.logger.error('Failed to send guild log command', error)
        })

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.application.off('minecraftChat', listener)
          resolve()
        }, timeout)

        const listener = (event: { instanceName: string; message: string }): void => {
          if (event.instanceName !== instance) return
          log.push({ message: event.message, instanceName: event.instanceName })
          if (log.length >= 50) {
            clearTimeout(timer)
            this.application.off('minecraftChat', listener)
            resolve()
          }
        }

        this.application.on('minecraftChat', listener)
      })

      sendSuccess(response, { entries: log })
    } catch (error: unknown) {
      this.logger.error('Failed to fetch guild log', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to fetch guild log', 502)
    }
  }

  private async handleMemberAccept(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username } = body as { username?: string }
    if (!username || typeof username !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid username', 400)
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    try {
      const result = await checkChatTriggers(
        this.application,
        this.application as unknown as EventHelper<InstanceType>,
        InviteAcceptChat,
        [instance],
        `/guild accept ${username}`,
        username
      )
      if (result.status === 'success') {
        sendSuccess(response, { success: true })
      } else {
        sendError(
          response,
          'INTERNAL_ERROR',
          result.message.map((m) => m.content).join('; ') || 'Failed to accept invite',
          502
        )
      }
    } catch (error: unknown) {
      this.logger.error('Failed to accept guild member', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to accept invite', 500)
    }
  }

  private async handleMemberInvite(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username } = body as { username?: string }
    if (!username || typeof username !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid username', 400)
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    try {
      const result = await checkChatTriggers(
        this.application,
        this.application as unknown as EventHelper<InstanceType>,
        InviteAcceptChat,
        [instance],
        `/guild invite ${username}`,
        username
      )
      if (result.status === 'success') {
        sendSuccess(response, { success: true })
      } else {
        sendError(
          response,
          'INTERNAL_ERROR',
          result.message.map((m) => m.content).join('; ') || 'Failed to invite player',
          502
        )
      }
    } catch (error: unknown) {
      this.logger.error('Failed to invite guild member', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to invite player', 500)
    }
  }

  private async handleMemberPromote(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username } = body as { username?: string }
    if (!username || typeof username !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid username', 400)
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    try {
      const result = await checkChatTriggers(
        this.application,
        this.application as unknown as EventHelper<InstanceType>,
        RankChat,
        [instance],
        `/guild promote ${username}`,
        username
      )
      if (result.status === 'success') {
        sendSuccess(response, { success: true })
      } else {
        sendError(
          response,
          'INTERNAL_ERROR',
          result.message.map((m) => m.content).join('; ') || 'Failed to promote player',
          502
        )
      }
    } catch (error: unknown) {
      this.logger.error('Failed to promote guild member', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to promote player', 500)
    }
  }

  private async handleMemberDemote(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username } = body as { username?: string }
    if (!username || typeof username !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid username', 400)
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    try {
      const result = await checkChatTriggers(
        this.application,
        this.application as unknown as EventHelper<InstanceType>,
        RankChat,
        [instance],
        `/guild demote ${username}`,
        username
      )
      if (result.status === 'success') {
        sendSuccess(response, { success: true })
      } else {
        sendError(
          response,
          'INTERNAL_ERROR',
          result.message.map((m) => m.content).join('; ') || 'Failed to demote player',
          502
        )
      }
    } catch (error: unknown) {
      this.logger.error('Failed to demote guild member', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to demote player', 500)
    }
  }

  private async handleMemberSetrank(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username, rank } = body as { username?: string; rank?: string }
    if (!username || typeof username !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid username', 400)
      return
    }
    if (!rank || typeof rank !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid rank', 400)
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    try {
      const result = await checkChatTriggers(
        this.application,
        this.application as unknown as EventHelper<InstanceType>,
        RankChat,
        [instance],
        `/guild setrank ${username} ${rank}`,
        username
      )
      if (result.status === 'success') {
        sendSuccess(response, { success: true })
      } else {
        sendError(
          response,
          'INTERNAL_ERROR',
          result.message.map((m) => m.content).join('; ') || 'Failed to set rank',
          502
        )
      }
    } catch (error: unknown) {
      this.logger.error('Failed to set rank for guild member', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to set rank', 500)
    }
  }

  private async handleBlacklist(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { action, username } = body as { action?: string; username?: string }
    if (!action || typeof action !== 'string' || (action !== 'add' && action !== 'remove')) {
      sendError(response, 'VALIDATION_ERROR', 'action must be "add" or "remove"', 400)
      return
    }
    if (!username || typeof username !== 'string') {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid username', 400)
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      sendError(response, 'INTERNAL_ERROR', 'No connected Minecraft instance', 502)
      return
    }

    const command = action === 'add' ? `/ignore add ${username}` : `/ignore remove ${username}`
    try {
      await this.application.sendMinecraft([instance], MinecraftSendChatPriority.High, undefined, command)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to update blacklist', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to update blacklist', 500)
    }
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
