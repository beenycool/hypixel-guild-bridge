import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'

import { sendError, sendSuccess } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

export class AppSettingsApiHandler {
  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  public async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false
    if (!rawUrl.split('?')[0].startsWith('/api/app-settings')) return false

    const method = (request.method ?? 'GET').toUpperCase()

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    if (permission < Permission.Admin) {
      sendError(response, 'FORBIDDEN', 'Forbidden', 403)
      return true
    }

    if (method === 'GET') {
      this.handleGet(response)
      return true
    }

    if (method === 'PUT') {
      const body = await this.readJsonBody(request as never, response)
      if (body === undefined) return true
      this.handlePut(response, body as Record<string, unknown>)
      return true
    }

    sendError(response, 'NOT_FOUND', 'Not found', 404)
    return true
  }

  private verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): Permission | undefined {
    const webConfig = this.application.config.web
    if (!webConfig?.signingSecret) return undefined
    const authHeader = request.headers.authorization
    const tokens = buildTokenSet(webConfig)
    const result = verifyToken(tokens, authHeader)
    if (result.ok) return result.permission
    sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
    return undefined
  }

  private handleGet(response: http.ServerResponse): void {
    const appSettings = this.application.core.appSettings
    sendSuccess(response, {
      urchinApiKey: { set: appSettings.getUrchinApiKey() !== undefined },
      openrouterApiKey: { set: appSettings.getOpenrouterApiKey() !== undefined },
      openrouterModel: { set: appSettings.getOpenrouterModel() !== undefined }
    })
  }

  private handlePut(response: http.ServerResponse, body: Record<string, unknown>): void {
    try {
      const appSettings = this.application.core.appSettings
      if (body.urchinApiKey !== undefined) {
        appSettings.setUrchinApiKey(this.stringOrUndefined(body.urchinApiKey))
      }
      if (body.openrouterApiKey !== undefined) {
        appSettings.setOpenrouterApiKey(this.stringOrUndefined(body.openrouterApiKey))
      }
      if (body.openrouterModel !== undefined) {
        appSettings.setOpenrouterModel(this.stringOrUndefined(body.openrouterModel))
      }
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to save app settings:', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to save app settings', 500)
    }
  }

  private stringOrUndefined(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    return value.trim().length === 0 ? undefined : value.trim()
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
}
