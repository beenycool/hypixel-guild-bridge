import type http from 'node:http'

import { HttpStatusCode } from 'axios'
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'
import type { InactivityEntry } from '../../core/users/inactivity.js'

import { buildTokenSet, verifyToken } from './auth.js'

const InactivityPrefix = '/api/inactivity'

export class InactivityApiHandler {
  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  private verifyAuth(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): { permission: Permission; userId?: string } | undefined {
    const webConfig = this.application.getWebConfig()
    if (!webConfig?.signingSecret) return undefined
    const result = verifyToken(buildTokenSet(webConfig), request.headers.authorization)
    if (!result.ok) {
      this.sendJson(response, HttpStatusCode.Unauthorized, { success: false, error: 'Invalid token' })
      return undefined
    }
    return { permission: result.permission, userId: result.userId }
  }

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart || !pathPart.startsWith(InactivityPrefix)) return false

    const method = request.method ?? 'GET'

    const auth = this.verifyAuth(request, response)
    if (auth === undefined) return true

    if (method === 'GET' && pathPart === InactivityPrefix) {
      if (auth.permission < Permission.Helper) {
        this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
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
      const approveMatch = pathPart.match(/^\/api\/inactivity\/([^/]+)\/approve$/)
      if (approveMatch) {
        if (auth.permission < Permission.Helper) {
          this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
          return true
        }
        await this.handleApprove(approveMatch[1], response)
        return true
      }

      const rejectMatch = pathPart.match(/^\/api\/inactivity\/([^/]+)\/reject$/)
      if (rejectMatch) {
        if (auth.permission < Permission.Helper) {
          this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
          return true
        }
        await this.handleReject(rejectMatch[1], response)
        return true
      }
    }

    this.sendMethodNotAllowed(response, ['GET', 'POST'])
    return true
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
            durationDays: Math.round((entry.expiresAt - entry.createdAt) / 86400)
          }
        })
      )
      this.sendJson(response, HttpStatusCode.Ok, { requests })
    } catch (error: unknown) {
      this.logger.error('Failed to list inactivity entries', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, {
        success: false,
        error: 'Failed to list inactivity entries'
      })
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
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid username' })
      return
    }
    if (typeof reason !== 'string' || reason.length === 0) {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid reason' })
      return
    }
    if (typeof durationDays !== 'number' || !Number.isFinite(durationDays) || durationDays < 1) {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing or invalid durationDays' })
      return
    }

    let uuid: string
    try {
      const profile = await this.application.mojangApi.profileByUsername(username)
      uuid = profile.id
    } catch {
      this.sendJson(response, HttpStatusCode.BadRequest, {
        success: false,
        error: 'Could not resolve Minecraft username'
      })
      return
    }

    const discordId = userId ?? ''
    const expiresAt = Math.floor(Date.now() / 1000) + durationDays * 86400

    try {
      this.application.core.inactivity.add({
        uuid,
        discordId,
        reason,
        expiresAt
      })
      this.sendJson(response, HttpStatusCode.Ok, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to create inactivity entry', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, {
        success: false,
        error: 'Failed to create inactivity entry'
      })
    }
  }

  private async handleApprove(uuid: string, response: http.ServerResponse): Promise<void> {
    const entry = this.application.core.inactivity.getActiveByUuid(uuid)
    if (!entry) {
      this.sendJson(response, HttpStatusCode.NotFound, { success: false, error: 'Inactivity request not found' })
      return
    }
    this.application.core.inactivity.removeByUuid(uuid)
    this.sendJson(response, HttpStatusCode.Ok, { success: true })
  }

  private async handleReject(uuid: string, response: http.ServerResponse): Promise<void> {
    const entry = this.application.core.inactivity.getActiveByUuid(uuid)
    if (!entry) {
      this.sendJson(response, HttpStatusCode.NotFound, { success: false, error: 'Inactivity request not found' })
      return
    }
    this.application.core.inactivity.removeByUuid(uuid)
    this.sendJson(response, HttpStatusCode.Ok, { success: true })
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
