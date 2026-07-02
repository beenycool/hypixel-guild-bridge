import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'
import type { SavedPunishment } from '../../core/moderation/punishments.js'

import { buildTokenSet, verifyToken } from './auth.js'
import { sendSuccess, sendError } from './api-utils.js'

const PunishmentIdPattern = /^\/api\/punishments\/([^/]+)\/forgive$/

const PunishmentsPrefix = '/api/punishments'

interface PunishmentQuery {
  userId?: string
  type?: string
  active?: string
}

export class PunishmentsApiHandler {
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

    const [pathPart, queryPart] = rawUrl.split('?')
    if (!pathPart || !pathPart.startsWith(PunishmentsPrefix)) return false

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    if (permission < Permission.Helper) {
      sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
      return true
    }

    if (request.method === 'GET' && pathPart === PunishmentsPrefix) {
      const query = this.parseQuery(queryPart) as PunishmentQuery
      await this.handleList(response, query)
      return true
    }

    if (request.method === 'POST') {
      const forgiveMatch = pathPart.match(PunishmentIdPattern)
      if (forgiveMatch) {
        await this.handleForgive(forgiveMatch[1], response)
        return true
      }
    }

    this.sendMethodNotAllowed(response, ['GET', 'POST'])
    return true
  }

  private async handleList(response: http.ServerResponse, query: PunishmentQuery): Promise<void> {
    try {
      let punishments: SavedPunishment[] = this.application.core.allPunishments()

      if (query.userId) {
        const userId = query.userId
        punishments = punishments.filter((p) => p.userId.toLowerCase() === userId.toLowerCase())
      }

      if (query.type) {
        const type = query.type
        punishments = punishments.filter((p) => p.type.toLowerCase() === type.toLowerCase())
      }

      if (query.active === 'true') {
        punishments = punishments.filter((p) => p.till > Date.now())
      } else if (query.active === 'false') {
        punishments = punishments.filter((p) => p.till <= Date.now())
      }

      const enriched = await Promise.all(
        punishments.map(async (p) => {
          let name: string | undefined
          try {
            const profile = await this.application.mojangApi.profileByUuid(p.userId)
            name = profile.name
          } catch {
            // not resolvable
          }
          return {
            ...p,
            name,
            createdAt: p.createdAt,
            till: p.till
          }
        })
      )

      sendSuccess(response, { punishments: enriched })
    } catch (error: unknown) {
      this.logger.error('Failed to list punishments', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to list punishments', 500)
    }
  }

  private async handleForgive(idStr: string, response: http.ServerResponse): Promise<void> {
    const id = parseInt(idStr, 10)
    if (!Number.isFinite(id)) {
      sendError(response, 'VALIDATION_ERROR', 'Invalid punishment id', 400)
      return
    }

    const removed = this.application.core.forgivePunishment(id)
    if (!removed) {
      sendError(response, 'NOT_FOUND', 'Punishment not found', 404)
      return
    }

    sendSuccess(response, { success: true })
  }

  private parseQuery(queryPart: string | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    if (!queryPart) return out
    const parameters = new URLSearchParams(queryPart)
    for (const [key, value] of parameters.entries()) {
      out[key] = value
    }
    return out
  }

  private sendMethodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '))
    sendError(response, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405)
  }
}
