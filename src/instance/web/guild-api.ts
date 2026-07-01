import type http from 'node:http'

import { HttpStatusCode } from 'axios'
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Status } from '../../common/connectable-instance.js'
import { type InstanceType, MinecraftSendChatPriority, Permission } from '../../common/application-event.js'
import type EventHelper from '../../common/event-helper.js'
import { checkChatTriggers, InviteAcceptChat, RankChat } from '../../utility/chat-triggers.js'

import { buildTokenSet, verifyToken } from './auth.js'

const GuildPrefix = '/api/guild'

export class GuildApiHandler {
  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  private verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): Permission | undefined {
    const webConfig = this.application.getWebConfig()
    if (!webConfig?.signingSecret) return undefined
    const result = verifyToken(buildTokenSet(webConfig), request.headers.authorization)
    if (!result.ok) {
      this.sendJson(response, HttpStatusCode.Unauthorized, { success: false, error: 'Invalid token' })
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
        this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
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
        this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
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
        this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
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
        this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
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
        this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
        return true
      }
      await this.handleMemberSetrank(request, response)
      return true
    }

    // GET /api/guild/leaderboard
    if (pathPart === `${GuildPrefix}/leaderboard`) {
      if (method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return true
      }
      const query = Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1] ?? ''))
      await this.handleLeaderboard(response, query as { range?: string })
      return true
    }

    // POST /api/guild/blacklist
    if (pathPart === `${GuildPrefix}/blacklist`) {
      if (method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return true
      }
      if (permission < Permission.Helper) {
        this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
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
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
      return
    }

    try {
      const guild = await this.application.hypixelApi.getGuild('player', instance, {})
      const weeklyGexp = guild.members.reduce((sum, m) => sum + m.weeklyExperience, 0)
      this.sendJson(response, HttpStatusCode.Ok, {
        name: guild.name,
        memberCount: guild.members.length,
        weeklyGexp,
        ranks: guild.ranks.map((r) => ({ name: r.name, priority: r.priority })),
        createdAt: guild.createdAt.getTime()
      })
    } catch (error: unknown) {
      this.logger.error('Failed to fetch guild overview', error)
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'Failed to fetch guild data' })
    }
  }

  private async handleMembers(response: http.ServerResponse): Promise<void> {
    const instance = this.getInstanceName()
    if (!instance) {
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
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
      this.sendJson(response, HttpStatusCode.Ok, { members })
    } catch (error: unknown) {
      this.logger.error('Failed to fetch guild members', error)
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'Failed to fetch guild members' })
    }
  }

  private async handleLog(response: http.ServerResponse): Promise<void> {
    const instance = this.getInstanceName()
    if (!instance) {
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
      return
    }

    try {
      const log: { message: string; instanceName: string }[] = []
      const timeout = 10_000

      this.application.sendMinecraft([instance], MinecraftSendChatPriority.High, undefined, '/guild log')

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

      this.sendJson(response, HttpStatusCode.Ok, { entries: log })
    } catch (error: unknown) {
      this.logger.error('Failed to fetch guild log', error)
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'Failed to fetch guild log' })
    }
  }

  private async handleLeaderboard(response: http.ServerResponse, query: { range?: string }): Promise<void> {
    try {
      const instance = this.getInstanceName()
      const scoresManager = this.application.core.scoresManager

      let gexp: { name: string; value: number }[] = []
      if (instance) {
        try {
          const guild = await this.application.hypixelApi.getGuild('player', instance, {})
          gexp = guild.members
            .map((m) => ({ uuid: m.uuid, value: m.weeklyExperience }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 100)
            .map((m) => ({ name: m.uuid, value: m.value }))
          gexp = await Promise.all(
            gexp.map(async (entry) => {
              try {
                const profile = await this.application.mojangApi.profileByUuid(entry.name)
                return { ...entry, name: profile.name }
              } catch {
                return entry
              }
            })
          )
        } catch {
          // guild fetch failed, return empty
        }
      }

      const messages = (scoresManager?.getMessages30Days() ?? [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 100)
        .map((m) => ({ name: m.uuid, value: m.count }))

      const onlineTime = (scoresManager?.getOnline30Days() ?? [])
        .sort((a, b) => b.totalTime - a.totalTime)
        .slice(0, 100)
        .map((m) => ({ name: m.uuid, value: m.totalTime }))

      this.sendJson(response, HttpStatusCode.Ok, { gexp, messages, onlineTime })
    } catch (error: unknown) {
      this.logger.error('Failed to fetch leaderboard', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, {
        success: false,
        error: 'Failed to fetch leaderboard'
      })
    }
  }

  private async handleMemberAccept(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username } = body as { username?: string }
    if (!username || typeof username !== 'string') {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid username' })
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
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
        this.sendJson(response, HttpStatusCode.Ok, { success: true })
      } else {
        this.sendJson(response, HttpStatusCode.BadGateway, {
          success: false,
          error: result.message.map((m) => m.content).join('; ') || 'Failed to accept invite'
        })
      }
    } catch (error: unknown) {
      this.logger.error('Failed to accept guild member', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, { success: false, error: 'Failed to accept invite' })
    }
  }

  private async handleMemberInvite(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username } = body as { username?: string }
    if (!username || typeof username !== 'string') {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid username' })
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
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
        this.sendJson(response, HttpStatusCode.Ok, { success: true })
      } else {
        this.sendJson(response, HttpStatusCode.BadGateway, {
          success: false,
          error: result.message.map((m) => m.content).join('; ') || 'Failed to invite player'
        })
      }
    } catch (error: unknown) {
      this.logger.error('Failed to invite guild member', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, { success: false, error: 'Failed to invite player' })
    }
  }

  private async handleMemberPromote(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username } = body as { username?: string }
    if (!username || typeof username !== 'string') {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid username' })
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
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
        this.sendJson(response, HttpStatusCode.Ok, { success: true })
      } else {
        this.sendJson(response, HttpStatusCode.BadGateway, {
          success: false,
          error: result.message.map((m) => m.content).join('; ') || 'Failed to promote player'
        })
      }
    } catch (error: unknown) {
      this.logger.error('Failed to promote guild member', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, { success: false, error: 'Failed to promote player' })
    }
  }

  private async handleMemberDemote(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username } = body as { username?: string }
    if (!username || typeof username !== 'string') {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid username' })
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
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
        this.sendJson(response, HttpStatusCode.Ok, { success: true })
      } else {
        this.sendJson(response, HttpStatusCode.BadGateway, {
          success: false,
          error: result.message.map((m) => m.content).join('; ') || 'Failed to demote player'
        })
      }
    } catch (error: unknown) {
      this.logger.error('Failed to demote guild member', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, { success: false, error: 'Failed to demote player' })
    }
  }

  private async handleMemberSetrank(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { username, rank } = body as { username?: string; rank?: string }
    if (!username || typeof username !== 'string') {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid username' })
      return
    }
    if (!rank || typeof rank !== 'string') {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid rank' })
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
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
        this.sendJson(response, HttpStatusCode.Ok, { success: true })
      } else {
        this.sendJson(response, HttpStatusCode.BadGateway, {
          success: false,
          error: result.message.map((m) => m.content).join('; ') || 'Failed to set rank'
        })
      }
    } catch (error: unknown) {
      this.logger.error('Failed to set rank for guild member', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, { success: false, error: 'Failed to set rank' })
    }
  }

  private async handleBlacklist(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return
    const { action, username } = body as { action?: string; username?: string }
    if (!action || typeof action !== 'string' || (action !== 'add' && action !== 'remove')) {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'action must be "add" or "remove"' })
      return
    }
    if (!username || typeof username !== 'string') {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid username' })
      return
    }

    const instance = this.getInstanceName()
    if (!instance) {
      this.sendJson(response, HttpStatusCode.BadGateway, { success: false, error: 'No connected Minecraft instance' })
      return
    }

    const command = action === 'add' ? `/ignore add ${username}` : `/ignore remove ${username}`
    try {
      await this.application.sendMinecraft([instance], MinecraftSendChatPriority.High, undefined, command)
      this.sendJson(response, HttpStatusCode.Ok, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to update blacklist', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, {
        success: false,
        error: 'Failed to update blacklist'
      })
    }
  }

  private async readJsonBody(request: http.IncomingMessage, response: http.ServerResponse): Promise<unknown> {
    let raw: string
    try {
      raw = await this.readBody(request)
    } catch (error: unknown) {
      this.logger.warn('Failed to read request body', error)
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Failed to read request body' })
      return undefined
    }
    if (raw.length === 0) {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing request body' })
      return undefined
    }
    try {
      return JSON.parse(raw)
    } catch (error: unknown) {
      this.logger.warn('Invalid JSON body', error)
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Invalid JSON body' })
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

  private sendJson(response: http.ServerResponse, status: number, body: object): void {
    response.writeHead(status)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
  }

  private sendMethodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '))
    this.sendJson(response, HttpStatusCode.MethodNotAllowed, { success: false, error: 'Method not allowed' })
  }
}
