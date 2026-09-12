import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type { Permission } from '../../common/application-event.js'

import { sendError } from './api-utils.js'
import { authorizeBridge as authorizeBridgeAccess, buildTokenSet, verifyToken } from './auth.js'

export interface WebAuthContext {
  permission: Permission
  userId?: string
  bridgeId?: string
}

export abstract class BaseApiHandler {
  constructor(
    protected readonly application: Application,
    protected readonly logger: Logger
  ) {}

  abstract handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean>

  protected verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): Permission | undefined {
    const auth = this.verifyAuthResult(request, response)
    return auth?.permission
  }

  protected verifyAuthWithUser(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): WebAuthContext | undefined {
    return this.verifyAuthResult(request, response)
  }

  protected authorizeBridge(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    requestedBridgeId: string | undefined,
    minimumPermission: Permission
  ): string | undefined {
    const auth = this.verifyAuthResult(request, response)
    if (auth === undefined) return undefined

    const result = authorizeBridgeAccess(
      { ok: true, permission: auth.permission, userId: auth.userId, bridgeId: auth.bridgeId },
      requestedBridgeId,
      minimumPermission
    )
    if (!result.ok) {
      sendError(response, 'FORBIDDEN', result.message, result.status)
      return undefined
    }
    return requestedBridgeId
  }

  private verifyAuthResult(request: http.IncomingMessage, response: http.ServerResponse): WebAuthContext | undefined {
    const webConfig = this.application.config.web
    if (!webConfig?.signingSecret) {
      sendError(response, 'UNAUTHORIZED', 'Web server is not configured', 401)
      return undefined
    }

    const result = verifyToken(buildTokenSet(webConfig), request.headers.authorization)
    if (!result.ok) {
      sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
      return undefined
    }

    return { permission: result.permission, userId: result.userId, bridgeId: result.bridgeId }
  }

  protected sendMethodNotAllowed(response: http.ServerResponse, allowed?: string[]): void {
    if (allowed && allowed.length > 0) {
      response.setHeader('Allow', allowed.join(', '))
    }
    sendError(response, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405)
  }
}
