import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'

import { sendError, sendSuccess } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

const QotdPrefix = '/api/qotd'

export class QotdApiHandler {
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
    if (!pathPart?.startsWith(QotdPrefix)) return false

    const method = request.method ?? 'GET'

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    if (permission < Permission.Owner) {
      sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
      return true
    }

    if (method === 'GET') {
      await this.handleGet(response)
      return true
    }

    if (method === 'PUT') {
      await this.handlePut(request, response)
      return true
    }

    this.sendMethodNotAllowed(response, ['GET', 'PUT'])
    return true
  }

  private async handleGet(response: http.ServerResponse): Promise<void> {
    const channelId = this.application.core.discordConfigurations.getQotdChannelId()
    const enabled = this.application.commandConfigManager.isCommandEnabled('discord', 'qotd')

    let channelName: string | undefined
    if (channelId) {
      try {
        const client = this.application.discordInstance.getClient()
        const ch = await client.channels.fetch(channelId).catch(() => undefined)
        if (ch && 'name' in ch) {
          channelName = (ch as { name: string }).name
        }
      } catch {
        // not resolvable
      }
    }

    sendSuccess(response, {
      enabled,
      channelId: channelId,
      channelName
    })
  }

  private async handlePut(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const { enabled, channelId } = body as { enabled?: unknown; channelId?: unknown }

    if (typeof enabled === 'boolean') {
      this.application.commandConfigManager.updateDiscordCommandConfig('qotd', { enabled }, 'web')
      this.application.commandConfigManager.save()
    }

    if (channelId !== undefined) {
      if (typeof channelId === 'string' && channelId.length > 0) {
        this.application.core.discordConfigurations.setQotdChannelId(channelId)
      } else if (channelId === null) {
        this.application.core.discordConfigurations.setQotdChannelId(undefined)
      } else {
        sendError(response, 'VALIDATION_ERROR', 'channelId must be a string or null', 400)
        return
      }
    }

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
