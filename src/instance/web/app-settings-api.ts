import type http from 'node:http'

import { Permission } from '../../common/application-event.js'

import { readJsonBody, sendError, sendSuccess } from './api-utils.js'
import { BaseApiHandler } from './base-api.js'

export class AppSettingsApiHandler extends BaseApiHandler {
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
      const body = await readJsonBody<Record<string, unknown>>(request, response, this.logger)
      if (body === undefined) return true
      this.handlePut(response, body)
      return true
    }

    sendError(response, 'NOT_FOUND', 'Not found', 404)
    return true
  }

  private handleGet(response: http.ServerResponse): void {
    const appSettings = this.application.core.appSettings
    sendSuccess(response, {
      urchinApiKey: { set: appSettings.getUrchinApiKey() !== undefined },
      seraphApiKey: { set: appSettings.getSeraphApiKey() !== undefined },
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
      if (body.seraphApiKey !== undefined) {
        appSettings.setSeraphApiKey(this.stringOrUndefined(body.seraphApiKey))
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
}
