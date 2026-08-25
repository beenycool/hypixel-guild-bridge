import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type { Permission } from '../../common/application-event.js'

import { sendError } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

export abstract class BaseApiHandler {
  constructor(
    protected readonly application: Application,
    protected readonly logger: Logger
  ) {}

  abstract handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean>

  protected verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): Permission | undefined {
    const webConfig = this.application.config.web
    if (!webConfig?.signingSecret) return undefined
    const result = verifyToken(buildTokenSet(webConfig), request.headers.authorization)
    if (!result.ok) {
      sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
      return undefined
    }
    return result.permission
  }

  protected verifyAuthWithUser(
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

  protected sendMethodNotAllowed(response: http.ServerResponse, allowed?: string[]): void {
    if (allowed && allowed.length > 0) {
      response.setHeader('Allow', allowed.join(', '))
    }
    sendError(response, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405)
  }
}
