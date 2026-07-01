import type http from 'node:http'

import { HttpStatusCode } from 'axios'
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'
import type { SavedPunishment } from '../../core/moderation/punishments.js'

import { buildTokenSet, verifyToken } from './auth.js'

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

    const [pathPart, queryPart] = rawUrl.split('?')
    if (!pathPart || !pathPart.startsWith(PunishmentsPrefix)) return false

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    if (permission < Permission.Helper) {
      this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
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

      this.sendJson(response, HttpStatusCode.Ok, { punishments: enriched })
    } catch (error: unknown) {
      this.logger.error('Failed to list punishments', error)
      this.sendJson(response, HttpStatusCode.InternalServerError, {
        success: false,
        error: 'Failed to list punishments'
      })
    }
  }

  private async handleForgive(idStr: string, response: http.ServerResponse): Promise<void> {
    const id = parseInt(idStr, 10)
    if (!Number.isFinite(id)) {
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Invalid punishment id' })
      return
    }

    const removed = this.application.core.forgivePunishment(id)
    if (!removed) {
      this.sendJson(response, HttpStatusCode.NotFound, { success: false, error: 'Punishment not found' })
      return
    }

    this.sendJson(response, HttpStatusCode.Ok, { success: true })
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
