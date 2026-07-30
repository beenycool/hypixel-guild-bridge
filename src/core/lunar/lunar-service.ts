import https from 'node:https'
import type { Logger } from 'log4js'
import NodeCache from 'node-cache'
import WebSocket from 'ws'

import type Application from '../../application.js'
import { Status } from '../../common/connectable-instance.js'
import { generateAesKey, formatServerId, sha1Hex } from './lunar-crypto.js'
import {
  decodeAuthMessage,
  decodeSubscribeV2Response,
  decodeUuid,
  decodeWsMessage,
  encodeAuthEncryptionResponse,
  encodeAuthHello,
  encodeHandshake,
  encodeRpcMessage,
  encodeSubscribeV2
} from './lunar-protobuf.js'

const AUTHENTICATOR_URL = 'wss://authenticator.lunarclientprod.com/game'
const GAME_WS_URL = 'wss://websocket.lunarclientprod.com/game'
const JOIN_SERVER_URL = 'https://sessionserver.mojang.com/session/minecraft/join'
const USER_AGENT = 'Lunar Client 1.8.9-2.16.0'

export class LunarService {
  private cache: NodeCache
  private gameWs: WebSocket | undefined
  private jwt: string | undefined
  private heartbeatInterval: NodeJS.Timeout | undefined
  private rpcCounter = 0
  private pendingRpcRequests = new Map<string, (output: Buffer) => void>()

  constructor(
    private readonly app: Application,
    private readonly logger: Logger,
    private readonly instanceName?: string,
    cacheSeconds = 60
  ) {
    this.cache = new NodeCache({ stdTTL: cacheSeconds })
  }

  /**
   * Retrieves Minecraft credentials (accessToken, uuid, username) from the target (or default connected) MinecraftInstance
   */
  private getCredentials(): { accessToken: string; uuid: string; username: string } | undefined {
    const instances = this.app.minecraftManager.getAllInstances()
    const instance = this.instanceName
      ? instances.find((i) => i.instanceName === this.instanceName && i.currentStatus() === Status.Connected)
      : instances.find((i) => i.currentStatus() === Status.Connected)

    return instance?.getLunarCredentials()
  }

  /**
   * Checks whether a player UUID is online on Lunar Client using SubscribeV2.
   * Returns true if using Lunar, false if not using Lunar, or undefined if Lunar check is unavailable.
   */
  public async checkLunarStatus(uuid: string): Promise<boolean | undefined> {
    const cached = this.cache.get<boolean>(uuid)
    if (cached !== undefined) return cached

    try {
      if (!this.gameWs || this.gameWs.readyState !== WebSocket.OPEN) {
        await this.ensureConnected()
      }

      if (!this.gameWs || this.gameWs.readyState !== WebSocket.OPEN) {
        return undefined
      }

      const isLunar = await this.querySubscribeV2(uuid)
      this.cache.set(uuid, isLunar)
      return isLunar
    } catch (error: unknown) {
      this.logger.debug(`Lunar status check failed for ${uuid}:`, error)
      return undefined
    }
  }

  private async ensureConnected(): Promise<void> {
    const creds = this.getCredentials()
    if (!creds) {
      this.logger.trace('No connected Minecraft instance available for Lunar Client authentication.')
      return
    }

    try {
      this.jwt = await this.authenticateWithLunar(creds.uuid, creds.username, creds.accessToken)
      if (this.jwt) {
        await this.connectGameWs(creds.uuid, creds.username, this.jwt)
      }
    } catch (error: unknown) {
      this.logger.warn('Failed to establish Lunar Client WebSocket session:', error)
    }
  }

  private async authenticateWithLunar(uuid: string, username: string, accessToken: string): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
      const ws = new WebSocket(AUTHENTICATOR_URL, {
        headers: { 'User-Agent': USER_AGENT }
      })

      ws.on('open', async () => {
        try {
          const hello = await encodeAuthHello(uuid, username)
          ws.send(hello)
        } catch (error: unknown) {
          ws.close()
          reject(error)
        }
      })

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = await decodeAuthMessage(data)
          if (msg.encryptionRequest) {
            const { publicKey: serverPubKeyDer, randomBytes: nonce } = msg.encryptionRequest
            const aesKey = generateAesKey()
            const serverId = formatServerId(sha1Hex(aesKey, serverPubKeyDer))

            await this.joinMojangServer(accessToken, uuid, serverId)

            const encResp = await encodeAuthEncryptionResponse(aesKey, nonce, serverPubKeyDer)
            ws.send(encResp)
          } else if (msg.authSuccess) {
            const jwtToken = msg.authSuccess.jwt as string
            ws.close()
            resolve(jwtToken)
          } else if (msg.encryptionFail) {
            ws.close()
            resolve(undefined)
          }
        } catch (error: unknown) {
          ws.close()
          reject(error)
        }
      })

      ws.on('error', (err: Error) => {
        reject(err)
      })
    })
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
            'User-Agent': USER_AGENT
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

  private async connectGameWs(uuid: string, username: string, jwt: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(GAME_WS_URL, {
        headers: { 'User-Agent': USER_AGENT }
      })

      ws.on('open', async () => {
        try {
          const handshake = await encodeHandshake(uuid, username, jwt)
          ws.send(handshake)

          this.gameWs = ws
          this.startHeartbeat()

          await this.sendRpc('lunarclient.websocket.cosmetic.v2.CosmeticService', 'Login', Buffer.alloc(0))
          resolve()
        } catch (error: unknown) {
          ws.close()
          reject(error)
        }
      })

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = await decodeWsMessage(data)
          if (msg.rpcResponse) {
            const reqId = msg.rpcResponse.requestId.toString()
            const callback = this.pendingRpcRequests.get(reqId)
            if (callback) {
              this.pendingRpcRequests.delete(reqId)
              callback(msg.rpcResponse.output as Buffer)
            }
          }
        } catch {
          // ignore non-RPC messages
        }
      })

      ws.on('close', () => {
        this.stopHeartbeat()
        this.gameWs = undefined
      })

      ws.on('error', (err: Error) => {
        this.stopHeartbeat()
        this.gameWs = undefined
        reject(err)
      })
    })
  }

  private async sendRpc(service: string, method: string, inputBytes: Buffer): Promise<Buffer> {
    if (!this.gameWs || this.gameWs.readyState !== WebSocket.OPEN) {
      throw new Error('Lunar Game WebSocket not connected')
    }

    const reqId = (++this.rpcCounter).toString()
    const rpcBytes = await encodeRpcMessage(reqId, service, method, inputBytes)

    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcRequests.delete(reqId)
        reject(new Error(`RPC timeout for ${service}.${method}`))
      }, 10_000)

      this.pendingRpcRequests.set(reqId, (output: Buffer) => {
        clearTimeout(timer)
        resolve(output)
      })

      this.gameWs?.send(rpcBytes)
    })
  }

  private async querySubscribeV2(uuid: string): Promise<boolean> {
    const inputBytes = await encodeSubscribeV2([uuid])
    const outputBytes = await this.sendRpc(
      'lunarclient.websocket.subscription.v1.SubscriptionService',
      'SubscribeV2',
      inputBytes
    )

    const resp = await decodeSubscribeV2Response(outputBytes)
    if (!resp.cosmeticPushes || !Array.isArray(resp.cosmeticPushes)) return false

    return resp.cosmeticPushes.some((push: { playerUuid?: { high?: unknown; low?: unknown } }) => {
      if (!push.playerUuid) return false
      const decodedUuid = decodeUuid(push.playerUuid as { high: unknown; low: unknown })
      return decodedUuid.replaceAll('-', '').toLowerCase() === uuid.replaceAll('-', '').toLowerCase()
    })
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      if (this.gameWs && this.gameWs.readyState === WebSocket.OPEN) {
        void this.sendRpc('lunarclient.websocket.heartbeat.v1.HeartbeatService', 'GameHeartbeat', Buffer.alloc(0)).catch(
          () => undefined
        )
      } else {
        this.stopHeartbeat()
      }
    }, 50_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }
  }
}
