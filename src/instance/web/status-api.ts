import type http from 'node:http'

import { HttpStatusCode } from 'axios'
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type { Permission } from '../../common/application-event.js'
import { Status } from '../../common/connectable-instance.js'

import { buildTokenSet, verifyToken } from './auth.js'

const StatusPrefix = '/api/status'

export class StatusApiHandler {
  private readonly startTime = Date.now()

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
    if (!pathPart || !pathPart.startsWith(StatusPrefix)) return false

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
      type: 'minecraft'
    }))

    this.sendJson(response, HttpStatusCode.Ok, {
      uptime: Date.now() - this.startTime,
      version: '2',
      minecraftConnected: connectedInstances.length > 0,
      discordConnected: discordClient.isReady(),
      discordLatency: discordClient.isReady() ? discordClient.ws.ping : null,
      instances,
      bridges,
      guild: guildInfo
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
