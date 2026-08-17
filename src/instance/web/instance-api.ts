import type http from 'node:http'

import { InstanceSignalType, MinecraftSendChatPriority, Permission } from '../../common/application-event.js'

import { readJsonBody, sendError, sendSuccess } from './api-utils.js'
import { BaseApiHandler } from './base-api.js'

const InstancePrefix = '/api/instance'

export class InstanceApiHandler extends BaseApiHandler {
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

    if (pathPart === `${InstancePrefix}/execute`) {
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleExecute(request, response)
      return true
    }

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
    const body = await readJsonBody<{ command?: unknown; instance?: unknown }>(request, response, this.logger)
    if (body === undefined) return

    const { command, instance: instanceName } = body

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
}
