import type http from 'node:http'

import { HttpStatusCode } from 'axios'
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'

import { buildTokenSet, verifyToken } from './auth.js'

const QotdPrefix = '/api/qotd'

export class QotdApiHandler {
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
    if (!pathPart || !pathPart.startsWith(QotdPrefix)) return false

    const method = request.method ?? 'GET'

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    if (permission < Permission.Owner) {
      this.sendJson(response, HttpStatusCode.Forbidden, { success: false, error: 'Insufficient permissions' })
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

    this.sendJson(response, HttpStatusCode.Ok, {
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
        this.sendJson(response, HttpStatusCode.BadRequest, {
          success: false,
          error: 'channelId must be a string or null'
        })
        return
      }
    }

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
