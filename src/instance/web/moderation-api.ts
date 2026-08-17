import type http from 'node:http'

import { Permission } from '../../common/application-event.js'

import { readJsonBody, sendError, sendSuccess } from './api-utils.js'
import { BaseApiHandler } from './base-api.js'

const ModerationPrefix = '/api/moderation'

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

export class ModerationApiHandler extends BaseApiHandler {
  public async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart.startsWith(ModerationPrefix)) return false

    const segments = pathPart
      .slice(ModerationPrefix.length + 1)
      .split('/')
      .filter(Boolean)
    const method = (request.method ?? 'GET').toUpperCase()

    if (segments.length !== 1 || segments[0] !== 'profanity') {
      sendError(response, 'NOT_FOUND', 'Not found', 404)
      return true
    }

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    if (method === 'GET') {
      this.handleGet(response)
      return true
    }

    if (method === 'PUT') {
      if (permission < Permission.Owner) {
        sendError(response, 'FORBIDDEN', 'Forbidden', 403)
        return true
      }
      const body = await readJsonBody<{ whitelist?: unknown; blacklist?: unknown }>(request, response, this.logger)
      if (body === undefined) return true
      this.handlePut(response, body)
      return true
    }

    sendError(response, 'NOT_FOUND', 'Not found', 404)
    return true
  }

  private handleGet(response: http.ServerResponse): void {
    try {
      const config = this.application.core.moderationConfiguration
      sendSuccess(response, {
        whitelist: config.getProfanityWhitelist(),
        blacklist: config.getProfanityBlacklist()
      })
    } catch (error: unknown) {
      this.logger.error('Failed to load profanity lists', error)
      sendError(
        response,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Failed to load profanity lists',
        500
      )
    }
  }

  private handlePut(response: http.ServerResponse, body: { whitelist?: unknown; blacklist?: unknown }): void {
    try {
      const config = this.application.core.moderationConfiguration
      config.setProfanityWhitelist(array(body.whitelist))
      config.setProfanityBlacklist(array(body.blacklist))
      this.application.core.reloadProfanity()
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to save profanity lists', error)
      sendError(
        response,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Failed to save profanity lists',
        500
      )
    }
  }
}
