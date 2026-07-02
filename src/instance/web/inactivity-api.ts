import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'
import type { InactivityEntry } from '../../core/users/inactivity.js'

import { buildTokenSet, verifyToken } from './auth.js'
import { sendSuccess, sendError } from './api-utils.js'

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
    if (!pathPart || !pathPart.startsWith(InactivityPrefix)) return false

    const method = request.method ?? 'GET'

    const auth = this.verifyAuth(request, response)
    if (auth === undefined) return true

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
      const approveMatch = pathPart.match(/^\/api\/inactivity\/([^/]+)\/approve$/)
      if (approveMatch) {
        if (auth.permission < Permission.Helper) {
          sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
          return true
        }
        await this.handleApprove(approveMatch[1], response)
        return true
      }

      const rejectMatch = pathPart.match(/^\/api\/inactivity\/([^/]+)\/reject$/)
      if (rejectMatch) {
        if (auth.permission < Permission.Helper) {
          sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
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
    const expiresAt = Math.floor(Date.now() / 1000) + durationDays * 86400

    try {
      this.application.core.inactivity.add({
        uuid,
        discordId,
        reason,
        expiresAt
      })
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to create inactivity entry', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to create inactivity entry', 500)
    }
  }

  private async handleApprove(uuid: string, response: http.ServerResponse): Promise<void> {
    const entry = this.application.core.inactivity.getActiveByUuid(uuid)
    if (!entry) {
      sendError(response, 'NOT_FOUND', 'Inactivity request not found', 404)
      return
    }
    this.application.core.inactivity.removeByUuid(uuid)
    sendSuccess(response, { success: true })
  }

  private async handleReject(uuid: string, response: http.ServerResponse): Promise<void> {
    const entry = this.application.core.inactivity.getActiveByUuid(uuid)
    if (!entry) {
      sendError(response, 'NOT_FOUND', 'Inactivity request not found', 404)
      return
    }
    this.application.core.inactivity.removeByUuid(uuid)
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

  private sendMethodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '))
    sendError(response, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405)
  }
}
