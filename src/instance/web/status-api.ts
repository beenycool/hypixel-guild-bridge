import type http from 'node:http'

import { Status } from '../../common/connectable-instance.js'

import { sendSuccess } from './api-utils.js'
import { BaseApiHandler } from './base-api.js'

const StatusPrefix = '/api/status'

export class StatusApiHandler extends BaseApiHandler {
  private readonly startTime = Date.now()

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart.startsWith(StatusPrefix)) return false

    if (request.method !== 'GET') {
      this.sendMethodNotAllowed(response, ['GET'])
      return true
    }

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    await this.handleStatus(response)
    return true
  }

  private async handleStatus(response: http.ServerResponse): Promise<void> {
    const mcInstances = this.application.minecraftManager.getAllInstances()
    const connectedInstances = mcInstances
      .filter((inst) => inst.currentStatus() === Status.Connected)
      .map((inst) => ({
        name: inst.instanceName,
        uuid: inst.uuid()
      }))

    const bridges = this.application.core.bridgeConfigurations.getAllBridgeIds()
    const discordClient = this.application.discordInstance.getClient()

    let guildInfo: { name?: string; memberCount?: number; weeklyGexp?: number } | undefined
    if (connectedInstances.length > 0) {
      const firstConnected = connectedInstances[0]
      {
        try {
          const guild = await this.application.hypixelApi.getGuild(
            'player',
            firstConnected.uuid ?? firstConnected.name,
            {}
          )
          const weeklyGexp = guild.members.reduce((sum, m) => sum + m.weeklyExperience, 0)
          guildInfo = {
            name: guild.name,
            memberCount: guild.members.length,
            weeklyGexp
          }
        } catch (error: unknown) {
          this.logger.warn('Failed to fetch guild info for status', error)
        }
      }
    }

    const instances = mcInstances.map((inst) => ({
      name: inst.instanceName,
      connected: inst.currentStatus() === Status.Connected,
      status: inst.currentStatus(),
      type: 'minecraft',
      disconnectTime: inst.lastDisconnectTime,
      reconnectAttempts: inst.reconnectAttempts
    }))

    sendSuccess(response, {
      uptime: Date.now() - this.startTime,
      version: '2',
      minecraftConnected: connectedInstances.length > 0,
      discordConnected: discordClient.isReady(),
      discordLatency: discordClient.isReady() ? discordClient.ws.ping : undefined,
      instances,
      bridges,
      guild: guildInfo
    })
  }
}
