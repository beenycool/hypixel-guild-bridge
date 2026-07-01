import { timingSafeEqual } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'

import { HttpStatusCode } from 'axios'
import type { RawData } from 'ws'
import { WebSocket, WebSocketServer } from 'ws'

import PackageJson from '../../package.json' with { type: 'json' }
import type { WebConfig } from '../application-config.js'
import type Application from '../application.js'
import type { ChatEvent } from '../common/application-event.js'
import { InstanceType, MinecraftSendChatPriority } from '../common/application-event.js'
import { Instance } from '../common/instance.js'

import { verifyToken } from './web/auth.js'
import { RankupApiHandler } from './web/rankup-api.js'
import { RankupWsEvents } from './web/rankup-ws-events.js'
import { SettingsApiHandler } from './web/settings-api.js'
import { SettingsWsEvents } from './web/settings-ws.js'

interface WebMessagePayload {
  type?: string
  token?: string
  data?: string
  instance?: string
}

interface WebSocketAckMessage {
  type: 'ack'
  success: boolean
  error?: string
}

interface WebSocketChatMessage {
  type: 'chat'
  data: WebChatPayload
}

interface WebChatPayload {
  eventId: string
  createdAt: number
  message: string
  channelType: ChatEvent['channelType']
  instanceName: string
  instanceType: ChatEvent['instanceType']
  user: {
    displayName: string
    minecraft?: {
      id: string
      name: string
    }
    discord?: {
      id: string
      displayName: string
    }
  }
  replyUsername?: string
  channelId?: string
  guildRank?: string
  hypixelRank?: string
  rawMessage?: string
}

interface DispatchResult {
  status: number
  body: {
    success: boolean
    error?: string
  }
}

const STATIC_MIME_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8']
])

export default class WebServer extends Instance<InstanceType.Utility> {
  private readonly startTime = Date.now()
  private readonly httpServer: http.Server
  private readonly wsServer: WebSocketServer
  private readonly connections = new Set<WebSocket>()
  private readonly config: WebConfig
  private readonly rankupApi: RankupApiHandler
  private readonly rankupWs: RankupWsEvents
  private readonly settingsApi: SettingsApiHandler
  private readonly settingsWs: SettingsWsEvents
  private readonly staticRoot: string
  private knownPublicUrl: string | undefined

  constructor(application: Application, config: WebConfig) {
    super(application, 'web-server', InstanceType.Utility)

    this.config = config

    this.httpServer = http.createServer((request, response) => {
      void this.handleHttpRequest(request, response).catch((error: unknown) => {
        this.logger.error('Failed to handle web request', error)
        if (!response.headersSent) {
          this.sendJson(response, HttpStatusCode.InternalServerError, {
            success: false,
            error: 'Internal server error'
          })
          return
        }
        response.end()
      })
    })

    this.wsServer = new WebSocketServer({ noServer: true })
    this.wsServer.on('connection', (socket) => {
      this.onWebSocketConnection(socket)
    })

    this.httpServer.on('upgrade', (request, socket, head) => {
      if (!this.isMessageRoute(request.url)) {
        socket.destroy()
        return
      }

      this.wsServer.handleUpgrade(request, socket, head, (client) => {
        this.wsServer.emit('connection', client, request)
      })
    })

    this.httpServer.listen(this.config.port, () => {
      this.logger.info(`Web server listening on port ${this.config.port}`)
    })

    this.application.on('chat', (event) => {
      this.broadcastChat(event)
    })

    this.rankupApi = new RankupApiHandler(application, this.logger)
    this.rankupWs = new RankupWsEvents(application, this.logger)
    this.settingsApi = new SettingsApiHandler(application, this.logger)
    this.settingsWs = new SettingsWsEvents(application, this.logger)
    this.staticRoot = resolve(process.cwd(), 'web/public')

    this.rankupWs.start()
    this.settingsWs.start()

    this.application.addShutdownListener(() => {
      this.shutdown()
    })
  }

  private isMessageRoute(url: string | undefined): boolean {
    if (!url) return false
    return url.split('?')[0] === '/message'
  }

  private async handleHttpRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const route = request.url?.split('?')[0]
    if (!route) {
      this.sendJson(response, HttpStatusCode.NotFound, { success: false, error: 'Invalid route' })
      return
    }

    this.recordPublicUrl(request)

    if (route === '/uptime') {
      if (request.method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return
      }

      this.sendJson(response, HttpStatusCode.Ok, {
        success: true,
        uptime: Date.now() - this.startTime
      })
      return
    }

    if (route === '/health') {
      if (request.method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return
      }

      this.sendJson(response, HttpStatusCode.Ok, {
        status: 'ok',
        uptime: Date.now() - this.startTime,
        version: PackageJson.version
      })
      return
    }

    if (route === '/message') {
      if (request.method !== 'POST') {
        this.sendMethodNotAllowed(response, ['POST'])
        return
      }

      await this.handleMessageRequest(request, response)
      return
    }

    if (route.startsWith('/api/rankup')) {
      await this.rankupApi.handle(request, response)
      return
    }

    if (route.startsWith('/api/settings')) {
      await this.settingsApi.handle(request, response)
      return
    }

    if (route === '/api/public-url') {
      if (request.method !== 'GET') {
        this.sendMethodNotAllowed(response, ['GET'])
        return
      }

      const url =
        this.knownPublicUrl ??
        (process.env.HEROKU_APP_NAME
          ? `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`
          : `http://localhost:${process.env.PORT}`)

      this.sendJson(response, HttpStatusCode.Ok, { url })
      return
    }

    if (route.startsWith('/api/')) {
      this.sendJson(response, HttpStatusCode.NotFound, { success: false, error: 'Invalid API route' })
      return
    }

    if (request.method === 'GET' && (await this.serveStatic(route, response))) {
      return
    }

    this.sendJson(response, HttpStatusCode.NotFound, { success: false, error: 'Invalid route' })
  }

  private async serveStatic(route: string, response: http.ServerResponse): Promise<boolean> {
    const relativePath = route === '/' ? 'index.html' : route.replace(/^\/+/, '')
    if (relativePath.includes('\0')) return false

    const filePath = normalize(join(this.staticRoot, relativePath))
    if (relative(this.staticRoot, filePath).startsWith('..')) {
      return false
    }

    if (!existsSync(filePath)) return false
    const stats = statSync(filePath)
    if (!stats.isFile()) return false

    const extension = extname(filePath).toLowerCase()
    const contentType = STATIC_MIME_TYPES.get(extension) ?? 'application/octet-stream'
    const cacheControl = extension === '.html' ? 'no-cache' : 'public, max-age=3600'

    try {
      const content = await readFile(filePath)
      response.writeHead(HttpStatusCode.Ok, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl
      })
      response.end(content)
      return true
    } catch (error: unknown) {
      this.logger.warn('Failed to read static file', error)
      return false
    }
  }

  private recordPublicUrl(request: http.IncomingMessage): void {
    const host =
      (request.headers['x-forwarded-host'] as string | undefined) ?? (request.headers.host as string | undefined)
    if (!host) return

    const proto = (request.headers['x-forwarded-proto'] as string | undefined) ?? 'https'
    const url = `${proto}://${host}`

    if (url === this.knownPublicUrl) return
    this.knownPublicUrl = url

    this.application.core.databaseManager
      .execute(
        `INSERT INTO "app_settings" ("key", "value", "updated_at") VALUES ($1, $2, NOW())
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW()`,
        ['public_url', url]
      )
      .catch((error: unknown) => {
        this.logger.warn('Failed to save public URL', error)
      })
  }

  private async handleMessageRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    let payload: WebMessagePayload | undefined

    try {
      const body = await this.readBody(request)
      if (!body) {
        this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Missing request body' })
        return
      }

      payload = JSON.parse(body) as WebMessagePayload | undefined
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Invalid payload format' })
        return
      }
    } catch (error: unknown) {
      this.logger.warn('Invalid /message payload', error)
      this.sendJson(response, HttpStatusCode.BadRequest, { success: false, error: 'Invalid JSON payload' })
      return
    }

    const result = await this.dispatchMessage(payload)
    this.sendJson(response, result.status, result.body)
  }

  private async dispatchMessage(payload: WebMessagePayload): Promise<DispatchResult> {
    if (
      !payload.token ||
      payload.token.length !== this.config.token.length ||
      !timingSafeEqual(Buffer.from(payload.token), Buffer.from(this.config.token))
    ) {
      return {
        status: HttpStatusCode.Unauthorized,
        body: { success: false, error: 'Invalid token' }
      }
    }

    if (payload.data == undefined || typeof payload.data !== 'string' || payload.data.trim().length === 0) {
      return {
        status: HttpStatusCode.BadRequest,
        body: { success: false, error: 'Missing message data' }
      }
    }

    const message = payload.data.trim()
    const target = this.resolveTargetInstances(payload.instance)
    if (target.error) {
      return {
        status: HttpStatusCode.BadRequest,
        body: { success: false, error: target.error }
      }
    }

    try {
      await this.application.sendMinecraft(target.instances, MinecraftSendChatPriority.Default, undefined, message)
      return {
        status: HttpStatusCode.Ok,
        body: { success: true }
      }
    } catch (error: unknown) {
      this.logger.error('Failed to send web message to Minecraft', error)
      return {
        status: HttpStatusCode.InternalServerError,
        body: { success: false, error: 'Failed to send message' }
      }
    }
  }

  private resolveTargetInstances(requested: string | undefined): { instances: string[]; error?: string } {
    const available = this.application.getInstancesNames(InstanceType.Minecraft)
    if (available.length === 0) {
      return { instances: [], error: 'No minecraft instances are connected.' }
    }

    const requestedName = requested?.trim()
    if (requestedName) {
      const match = available.find((name) => name.toLowerCase() === requestedName.toLowerCase())
      if (!match) {
        return { instances: [], error: `Unknown minecraft instance "${requestedName}".` }
      }
      return { instances: [match] }
    }

    const configInstance = this.config.minecraftInstance?.trim()
    if (configInstance) {
      const match = available.find((name) => name.toLowerCase() === configInstance.toLowerCase())
      if (!match) {
        return { instances: [], error: `Configured minecraft instance "${configInstance}" is not available.` }
      }
      return { instances: [match] }
    }

    if (available.length === 1) {
      return { instances: [available[0]] }
    }

    return {
      instances: [],
      error: 'Multiple minecraft instances are available. Specify an instance.'
    }
  }

  private onWebSocketConnection(socket: WebSocket): void {
    this.connections.add(socket)
    this.logger.info('WebSocket client connected')

    socket.on('close', () => {
      this.connections.delete(socket)
      this.rankupWs.unsubscribe(socket)
      this.settingsWs.unsubscribe(socket)
    })

    socket.on('error', (error) => {
      this.logger.warn('WebSocket error', error)
      this.connections.delete(socket)
      this.rankupWs.unsubscribe(socket)
      this.settingsWs.unsubscribe(socket)
    })

    socket.on('message', (data) => {
      void this.handleWebSocketMessage(socket, data).catch((error: unknown) => {
        this.logger.error('Failed to handle websocket message', error)
        this.sendWebSocket(socket, { type: 'ack', success: false, error: 'Failed to handle message' })
      })
    })
  }

  private async handleWebSocketMessage(socket: WebSocket, data: RawData): Promise<void> {
    let payload: WebMessagePayload
    try {
      const text = WebServer.rawDataToString(data)
      payload = JSON.parse(text) as WebMessagePayload
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        this.sendWebSocket(socket, { type: 'ack', success: false, error: 'Invalid payload' })
        return
      }
    } catch {
      this.sendWebSocket(socket, { type: 'ack', success: false, error: 'Invalid JSON payload' })
      return
    }

    if (payload.type === 'subscribeRankup') {
      const auth = verifyToken(this.config.token, undefined, payload.token)
      if (!auth.ok) {
        this.sendWebSocket(socket, { type: 'ack', success: false, error: 'Invalid token' })
        return
      }
      this.rankupWs.subscribe(socket)
      this.sendWebSocket(socket, { type: 'ack', success: true })
      return
    }

    if (payload.type === 'subscribeSettings') {
      const auth = verifyToken(this.config.token, undefined, payload.token)
      if (!auth.ok) {
        this.sendWebSocket(socket, { type: 'ack', success: false, error: 'Invalid token' })
        return
      }
      this.settingsWs.subscribe(socket)
      this.sendWebSocket(socket, { type: 'ack', success: true })
      return
    }

    if (payload.type !== undefined && payload.type !== 'message') {
      this.sendWebSocket(socket, { type: 'ack', success: false, error: 'Unsupported payload type' })
      return
    }

    const result = await this.dispatchMessage(payload)
    this.sendWebSocket(socket, {
      type: 'ack',
      success: result.body.success,
      error: result.body.error
    })
  }

  private static rawDataToString(data: RawData): string {
    if (typeof data === 'string') return data
    if (Buffer.isBuffer(data)) return data.toString('utf8')
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
    // This should never happen based on RawData type definition, but handle it safely
    return Buffer.from(data as Uint8Array).toString('utf8')
  }

  private broadcastChat(event: ChatEvent): void {
    if (this.connections.size === 0) return
    const message: WebSocketChatMessage = {
      type: 'chat',
      data: this.buildChatPayload(event)
    }

    const payload = JSON.stringify(message)
    for (const socket of this.connections) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.connections.delete(socket)
        continue
      }

      try {
        socket.send(payload)
      } catch (error: unknown) {
        this.logger.warn('Failed to send websocket payload', error)
        this.connections.delete(socket)
      }
    }
  }

  private buildChatPayload(event: ChatEvent): WebChatPayload {
    const mojang = event.user.mojangProfile()
    const discord = event.user.discordProfile()

    const payload: WebChatPayload = {
      eventId: event.eventId,
      createdAt: event.createdAt,
      message: event.message,
      channelType: event.channelType,
      instanceName: event.instanceName,
      instanceType: event.instanceType,
      user: {
        displayName: event.user.displayName(),
        minecraft: mojang
          ? {
              id: mojang.id,
              name: mojang.name
            }
          : undefined,
        discord: discord
          ? {
              id: discord.id,
              displayName: discord.displayName
            }
          : undefined
      }
    }

    if ('replyUsername' in event) payload.replyUsername = event.replyUsername
    if ('channelId' in event) payload.channelId = event.channelId
    if ('guildRank' in event) payload.guildRank = event.guildRank
    if ('hypixelRank' in event) payload.hypixelRank = event.hypixelRank
    if ('rawMessage' in event) payload.rawMessage = event.rawMessage

    return payload
  }

  private sendJson(response: http.ServerResponse, status: number, body: Record<string, unknown>): void {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  private sendMethodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '))
    this.sendJson(response, HttpStatusCode.MethodNotAllowed, { success: false, error: 'Method not allowed' })
  }

  private sendWebSocket(socket: WebSocket, message: WebSocketAckMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(message))
  }

  private async readBody(request: http.IncomingMessage): Promise<string> {
    request.setEncoding('utf8')
    return await new Promise((resolve, reject) => {
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

  private shutdown(): void {
    for (const socket of this.connections) {
      socket.close()
    }
    this.connections.clear()
    this.rankupWs.stop()
    this.settingsWs.stop()
    this.wsServer.close()
    this.httpServer.close()
  }
}
