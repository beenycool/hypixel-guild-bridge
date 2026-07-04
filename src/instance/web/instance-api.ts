import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { InstanceSignalType, MinecraftSendChatPriority, Permission } from '../../common/application-event.js'

import { sendError, sendSuccess } from './api-utils.js'
import { buildTokenSet, verifyToken } from './auth.js'

const InstancePrefix = '/api/instance'

export class InstanceApiHandler {
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
    if (!pathPart.startsWith(InstancePrefix)) return false

    if (request.method !== 'POST') {
      this.sendMethodNotAllowed(response, ['POST'])
      return true
    }

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    // POST /api/instance/execute
    if (pathPart === `${InstancePrefix}/execute`) {
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleExecute(request, response)
      return true
    }

    // POST /api/instance/:name/disconnect
    // POST /api/instance/:name/reconnect
    // POST /api/instance/:name/restart
    const rest = pathPart.slice(InstancePrefix.length + 1)
    const segments = rest.split('/')
    if (segments.length !== 2) {
      sendError(response, 'NOT_FOUND', 'Not found', 404)
      return true
    }

    const [instanceName, action] = segments

    switch (action) {
      case 'disconnect':
      case 'reconnect': {
        if (permission < Permission.Helper) {
          sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
          return true
        }
        break
      }
      case 'restart': {
        if (permission < Permission.Admin) {
          sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
          return true
        }
        break
      }
      default: {
        sendError(response, 'NOT_FOUND', 'Unknown action', 404)
        return true
      }
    }

    await this.handleInstanceAction(response, instanceName, action)
    return true
  }

  private async handleInstanceAction(
    response: http.ServerResponse,
    instanceName: string,
    action: string
  ): Promise<void> {
    const instance = this.application.minecraftManager
      .getAllInstances()
      .find((inst) => inst.instanceName.toLowerCase() === instanceName.toLowerCase())

    if (!instance) {
      sendError(response, 'NOT_FOUND', `Instance "${instanceName}" not found`, 404)
      return
    }

    try {
      switch (action) {
        case 'disconnect': {
          await this.application.sendSignal([instance.instanceName], InstanceSignalType.Shutdown)
          break
        }
        case 'reconnect': {
          await this.application.sendSignal([instance.instanceName], InstanceSignalType.Restart)
          break
        }
        case 'restart': {
          await this.application.sendSignal([instance.instanceName], InstanceSignalType.Restart)
          break
        }
      }
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to %s instance %s', action, instanceName, error)
      sendError(response, 'INTERNAL_ERROR', `Failed to ${action} instance`, 500)
    }
  }

  private async handleExecute(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request, response)
    if (body === undefined) return

    const { command, instance: instanceName } = body as { command?: unknown; instance?: unknown }

    if (typeof command !== 'string' || command.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid command', 400)
      return
    }

    const instances = this.application.minecraftManager.getAllInstances()
    let targetInstances: string[]

    if (typeof instanceName === 'string' && instanceName.length > 0) {
      const match = instances.find((inst) => inst.instanceName.toLowerCase() === instanceName.toLowerCase())
      if (!match) {
        sendError(response, 'NOT_FOUND', `Instance "${instanceName}" not found`, 404)
        return
      }
      targetInstances = [match.instanceName]
    } else {
      targetInstances = instances.map((inst) => inst.instanceName)
    }

    try {
      await this.application.sendMinecraft(targetInstances, MinecraftSendChatPriority.High, undefined, command)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to execute command on instance', error)
      sendError(response, 'INTERNAL_ERROR', 'Failed to execute command', 500)
    }
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
