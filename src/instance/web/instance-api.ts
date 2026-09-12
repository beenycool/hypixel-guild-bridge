import type http from 'node:http'

import { InstanceSignalType, MinecraftSendChatPriority, Permission } from '../../common/application-event.js'
import type MinecraftInstance from '../minecraft/minecraft-instance.js'

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

    const auth = this.verifyAuthWithUser(request, response)
    if (auth === undefined) return true
    const permission = auth.permission

    if (auth.bridgeId === undefined) {
      sendError(response, 'FORBIDDEN', 'Token is not bound to a bridge', 403)
      return true
    }
    const bridgeId = auth.bridgeId

    if (pathPart === `${InstancePrefix}/execute`) {
      if (permission < Permission.Helper) {
        sendError(response, 'FORBIDDEN', 'Insufficient permissions', 403)
        return true
      }
      await this.handleExecute(request, response, bridgeId)
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

    await this.handleInstanceAction(response, instanceName, action, bridgeId)
    return true
  }

  private findBridgeInstance(instanceName: string, bridgeId: string): MinecraftInstance | undefined {
    const match = this.application.minecraftManager
      .getAllInstances()
      .find((inst) => inst.instanceName.toLowerCase() === instanceName.toLowerCase())
    if (match === undefined) return undefined
    if (this.application.bridgeResolver.getBridgeIdForInstance(match.instanceName) !== bridgeId) return undefined
    return match
  }

  private async handleInstanceAction(
    response: http.ServerResponse,
    instanceName: string,
    action: string,
    bridgeId: string
  ): Promise<void> {
    const instance = this.findBridgeInstance(instanceName, bridgeId)
    if (!instance) {
      const exists = this.application.minecraftManager
        .getAllInstances()
        .some((inst) => inst.instanceName.toLowerCase() === instanceName.toLowerCase())
      if (exists) {
        sendError(response, 'FORBIDDEN', `Instance "${instanceName}" does not belong to this bridge`, 403)
      } else {
        sendError(response, 'NOT_FOUND', `Instance "${instanceName}" not found`, 404)
      }
      return
    }

    const signal = action === 'disconnect' ? InstanceSignalType.Shutdown : InstanceSignalType.Restart
    try {
      await this.application.sendSignal([instance.instanceName], signal)
      sendSuccess(response, { success: true })
    } catch (error: unknown) {
      this.logger.error('Failed to %s instance %s', action, instanceName, error)
      sendError(response, 'INTERNAL_ERROR', `Failed to ${action} instance`, 500)
    }
  }

  private async handleExecute(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    bridgeId: string
  ): Promise<void> {
    const body = await readJsonBody<{ command?: unknown; instance?: unknown }>(request, response, this.logger)
    if (body === undefined) return

    const { command, instance: instanceName } = body

    if (typeof command !== 'string' || command.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing or invalid command', 400)
      return
    }

    const allInstances = this.application.minecraftManager.getAllInstances()
    let targetInstances: string[]

    if (typeof instanceName === 'string' && instanceName.length > 0) {
      const match = this.findBridgeInstance(instanceName, bridgeId)
      if (!match) {
        const exists = allInstances.some((inst) => inst.instanceName.toLowerCase() === instanceName.toLowerCase())
        if (exists) {
          sendError(response, 'FORBIDDEN', `Instance "${instanceName}" does not belong to this bridge`, 403)
        } else {
          sendError(response, 'NOT_FOUND', `Instance "${instanceName}" not found`, 404)
        }
        return
      }
      targetInstances = [match.instanceName]
    } else {
      const configured = this.application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
      const target = configured
        .map((name) => allInstances.find((inst) => inst.instanceName.toLowerCase() === name.toLowerCase()))
        .find(
          (inst): inst is MinecraftInstance =>
            inst !== undefined && this.application.bridgeResolver.getBridgeIdForInstance(inst.instanceName) === bridgeId
        )
      if (!target) {
        sendError(response, 'VALIDATION_ERROR', 'No Minecraft instance is assigned to this bridge', 400)
        return
      }
      targetInstances = [target.instanceName]
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
