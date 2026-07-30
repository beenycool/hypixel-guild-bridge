import https from 'node:https'
import type { Logger } from 'log4js'
import NodeCache from 'node-cache'
import WebSocket from 'ws'

import type Application from '../../application.js'
import { Status } from '../../common/connectable-instance.js'
import { generateSharedSecret, computeEssentialSessionHash } from './essential-crypto.js'
import { decodePacket, encodePacket } from './essential-packets.js'

const ESSENTIAL_WS_URL = 'wss://connect.essential.gg/v1'
const JOIN_SERVER_URL = 'https://sessionserver.mojang.com/session/minecraft/join'

export class EssentialService {
  private cache: NodeCache
  private ws: WebSocket | undefined
  private packetTypeMap = new Map<number, string>()
  private packetNameMap = new Map<string, number>()
  private nextOutgoingTypeId = 1
  private pendingStatusRequests = new Map<string, (online: boolean) => void>()

  constructor(
    private readonly app: Application,
    private readonly logger: Logger,
    private readonly instanceName?: string,
    cacheSeconds = 60
  ) {
    this.cache = new NodeCache({ stdTTL: cacheSeconds })
  }

  private getCredentials(): { accessToken: string; uuid: string; username: string } | undefined {
    const instances = this.app.minecraftManager.getAllInstances()
    const targetName = this.instanceName?.toLowerCase()

    let instance = targetName
      ? instances.find((i) => i.instanceName.toLowerCase() === targetName && i.currentStatus() === Status.Connected)
      : undefined

    instance ??= instances.find((i) => i.currentStatus() === Status.Connected)
    return instance?.getLunarCredentials()
  }

  public async checkEssentialStatus(uuid: string): Promise<boolean | undefined> {
    const cached = this.cache.get<boolean>(uuid)
    if (cached !== undefined) return cached

    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.ensureConnected()
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return undefined
      }

      const isOnline = await this.queryPlayerStatus(uuid)
      this.cache.set(uuid, isOnline)
      return isOnline
    } catch (error: unknown) {
      this.logger.debug(`Essential status check failed for ${uuid}:`, error)
      return undefined
    }
  }

  private async ensureConnected(): Promise<void> {
    const creds = this.getCredentials()
    if (!creds) {
      this.logger.trace('No connected Minecraft instance available for Essential authentication.')
      return
    }

    try {
      await this.connectWebSocket(creds.accessToken, creds.uuid, creds.username)
    } catch (error: unknown) {
      this.logger.warn('Failed to establish Essential WebSocket session:', error)
    }
  }

  private async connectWebSocket(accessToken: string, uuid: string, username: string): Promise<void> {
    const sharedSecret = generateSharedSecret()
    const serverId = computeEssentialSessionHash(sharedSecret)

    // Step 1: Mojang joinServer
    await this.joinMojangServer(accessToken, uuid, serverId)

    // Step 2: Open WebSocket with Essential auth headers
    const authString = Buffer.from(username + ':' + sharedSecret.toString('binary'), 'binary').toString('base64')

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(ESSENTIAL_WS_URL, {
        headers: {
          Authorization: `Basic ${authString}`,
          'Essential-User-UUID': uuid,
          'Essential-User-Name': username,
          'Essential-Max-Protocol-Version': '10',
          'Essential-Mod-Version': '1.3.4.1',
          'Essential-Mod-Branch': 'stable',
          'Essential-Mod-Commit': '0000000'
        }
      })

      let resolved = false

      ws.on('open', () => {
        this.ws = ws
        this.packetTypeMap.clear()
        this.packetNameMap.clear()
        this.nextOutgoingTypeId = 1

        // Register our outgoing SubscriptionUpdatePacket
        this.registerOutgoingPacketType('subscription.SubscriptionUpdatePacket')
        resolved = true
        resolve()
      })

      ws.on('message', (data: Buffer) => {
        this.handleMessage(data)
      })

      ws.on('close', () => {
        this.ws = undefined
        this.rejectAllPending()
      })

      ws.on('error', (err: Error) => {
        this.ws = undefined
        this.rejectAllPending()
        if (!resolved) reject(err)
      })
    })
  }

  private handleMessage(data: Buffer): void {
    try {
      const packet = decodePacket(data)

      if (packet.typeId === 0) {
        // Packet type registration
        const name = (packet.json as { a: string }).a
        const id = (packet.json as { b: number }).b
        this.packetTypeMap.set(id, name)
        this.packetNameMap.set(name, id)
        return
      }

      const packetName = this.packetTypeMap.get(packet.typeId)

      if (packetName === 'connection.ConnectionKeepAlivePacket') {
        // Respond to keep-alive with same packetId
        this.sendPacket(packet.typeId, packet.packetId, {})
        return
      }

      if (packetName === 'profile.ServerProfileStatusPacket') {
        const json = packet.json as { a: string; b: string }
        const playerUuid = json.a
        const status = json.b

        const callback = this.pendingStatusRequests.get(playerUuid.replaceAll('-', '').toLowerCase())
        if (callback) {
          this.pendingStatusRequests.delete(playerUuid.replaceAll('-', '').toLowerCase())
          callback(status === 'ONLINE')
        }
      }
    } catch {
      // Ignore malformed packets
    }
  }

  private async queryPlayerStatus(uuid: string): Promise<boolean> {
    const subscriptionTypeId = this.packetNameMap.get('subscription.SubscriptionUpdatePacket')
    if (subscriptionTypeId === undefined) {
      throw new Error('SubscriptionUpdatePacket type not registered')
    }

    // Subscribe to the UUID
    this.sendPacket(subscriptionTypeId, '', {
      a: [uuid],
      b: false,
      c: true
    })

    // Wait for profile status response
    const normalizedUuid = uuid.replaceAll('-', '').toLowerCase()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingStatusRequests.delete(normalizedUuid)
        // No response within timeout means player is likely not on Essential
        resolve(false)
      }, 10_000)

      this.pendingStatusRequests.set(normalizedUuid, (online: boolean) => {
        clearTimeout(timer)
        resolve(online)
      })
    })
  }

  private registerOutgoingPacketType(name: string): void {
    const id = this.nextOutgoingTypeId++
    this.sendPacket(0, '', { a: name, b: id })
    this.packetTypeMap.set(id, name)
    this.packetNameMap.set(name, id)
  }

  private sendPacket(typeId: number, packetId: string, json: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(encodePacket(typeId, packetId, json))
  }

  private rejectAllPending(): void {
    for (const [, callback] of this.pendingStatusRequests) {
      callback(false)
    }
    this.pendingStatusRequests.clear()
  }

  private async joinMojangServer(accessToken: string, playerUuid: string, serverId: string): Promise<void> {
    const uuidNoDashes = playerUuid.replaceAll('-', '')
    const postData = JSON.stringify({
      accessToken,
      selectedProfile: uuidNoDashes,
      serverId
    })

    return new Promise<void>((resolve, reject) => {
      const parsed = new URL(JOIN_SERVER_URL)
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'Essential/1.3.4.1'
          }
        },
        (res) => {
          if (res.statusCode === 204 || (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300)) {
            resolve()
          } else {
            reject(new Error(`Mojang joinServer returned HTTP ${res.statusCode}`))
          }
        }
      )
      req.on('error', reject)
      req.write(postData)
      req.end()
    })
  }
}
