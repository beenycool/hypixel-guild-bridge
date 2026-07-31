import https from 'node:https'

import type { Logger } from 'log4js'
import NodeCache from 'node-cache'

import type Application from '../../application.js'
import { Status } from '../../common/connectable-instance.js'

const FeatherApiBase = 'https://api.feathermc.com/v1'
const MojangJoinUrl = 'https://sessionserver.mojang.com/session/minecraft/join'
const UserAgentHeader = 'Feather Client/1.0.0'

export class FeatherService {
  private cache: NodeCache
  private jwt: string | undefined
  private lastAuthFailedAt = 0
  private authCooldownMs = 5000

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
    const targetName = this.instanceName?.toLowerCase()

    let instance = targetName
      ? instances.find(
          (targetInstance) =>
            targetInstance.instanceName.toLowerCase() === targetName &&
            targetInstance.currentStatus() === Status.Connected
        )
      : undefined

    instance ??= instances.find((targetInstance) => targetInstance.currentStatus() === Status.Connected)

    return instance?.getLunarCredentials()
  }

  /**
   * Checks whether a player UUID is online on Feather Client using REST account-search.
   * Returns true if online on Feather, false if offline/not on Feather, or undefined if Feather check is unavailable.
   */
  public async checkFeatherStatus(uuid: string): Promise<boolean | undefined> {
    const cached = this.cache.get<boolean>(uuid)
    if (cached !== undefined) return cached

    try {
      await this.ensureAuthenticated()
      if (!this.jwt) {
        return undefined
      }

      const isFeather = await this.queryAccountSearch(uuid)
      this.cache.set(uuid, isFeather)
      return isFeather
    } catch (error: unknown) {
      this.logger.debug(`Feather status check failed for ${uuid}:`, error)
      return undefined
    }
  }

  public async ensureAuthenticated(): Promise<void> {
    if (this.jwt) return

    const timeSinceLastFail = Date.now() - this.lastAuthFailedAt
    if (timeSinceLastFail < this.authCooldownMs) {
      this.logger.debug(
        `[FeatherService] Skipping auth attempt (${this.authCooldownMs - timeSinceLastFail}ms remaining in cooldown)`
      )
      return
    }

    const creds = this.getCredentials()
    if (!creds) {
      this.logger.info(
        '[FeatherService] Cannot connect: No connected Minecraft instance available for Feather Client authentication.'
      )
      return
    }

    try {
      this.logger.info(
        `[FeatherService] Authenticating with Feather Client API using account '${creds.username}' (${creds.uuid})...`
      )
      this.jwt = await this.authenticateWithFeather(creds.uuid, creds.username, creds.accessToken)
      if (this.jwt) {
        this.authCooldownMs = 5000
        this.logger.info('[FeatherService] Successfully authenticated with Feather Client API!')
      } else {
        this.logger.warn('[FeatherService] Feather Client authentication failed: No JWT returned.')
      }
    } catch (error: unknown) {
      this.lastAuthFailedAt = Date.now()
      this.authCooldownMs = Math.min(this.authCooldownMs * 2, 60_000)
      this.logger.warn('[FeatherService] Failed to establish Feather Client session:', error)
    }
  }

  private async authenticateWithFeather(
    uuid: string,
    username: string,
    accessToken: string
  ): Promise<string | undefined> {
    const rawServerId = await this.httpRequest('GET', '/minecraft/server-id')
    const serverId = parseMaybeJsonString(rawServerId)

    await this.joinMojangServer(accessToken, uuid, serverId)

    const jwt = await this.hasJoinedFeather(username, serverId)
    return jwt
  }

  private async joinMojangServer(accessToken: string, playerUuid: string, serverId: string): Promise<void> {
    const uuidNoDashes = playerUuid.replaceAll('-', '')
    const postData = JSON.stringify({
      accessToken,
      selectedProfile: uuidNoDashes,
      serverId
    })

    /* eslint-disable @typescript-eslint/naming-convention */
    const headers: Record<string, string | number> = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(postData),
      'user-agent': UserAgentHeader
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    return new Promise<void>((resolve, reject) => {
      const parsed = new URL(MojangJoinUrl)
      const request = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'POST',
          headers
        },
        (response) => {
          if (
            response.statusCode === 204 ||
            (response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300)
          ) {
            resolve()
          } else {
            reject(new Error(`Mojang joinServer returned HTTP ${response.statusCode}`))
          }
        }
      )
      request.on('error', reject)
      request.write(postData)
      request.end()
    })
  }

  private async hasJoinedFeather(username: string, serverId: string): Promise<string | undefined> {
    /* eslint-disable @typescript-eslint/naming-convention */
    const headers: Record<string, string> = {
      'user-agent': UserAgentHeader
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    return new Promise<string | undefined>((resolve, reject) => {
      const path = `/v1/minecraft/has-joined/${encodeURIComponent(username)}?token=${encodeURIComponent(serverId)}`
      const parsed = new URL(FeatherApiBase)

      const request = https.request(
        {
          hostname: parsed.hostname,
          path,
          method: 'GET',
          headers
        },
        (response) => {
          const authHeader = response.headers.authorization ?? response.headers.Authorization
          if (typeof authHeader === 'string' && authHeader.length > 0) {
            resolve(authHeader)
            return
          }
          if (response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300) {
            let body = ''
            response.on('data', (chunk: Buffer | string) => {
              body += chunk.toString()
            })
            response.on('end', () => {
              const token = parseMaybeJsonString(body)
              resolve(token || undefined)
            })
          } else {
            reject(new Error(`Feather has-joined returned HTTP ${response.statusCode}`))
          }
        }
      )
      request.on('error', reject)
      request.end()
    })
  }

  private async queryAccountSearch(uuid: string): Promise<boolean> {
    const uuidNoDashes = uuid.replaceAll('-', '')
    const postData = JSON.stringify({ mcID: [uuidNoDashes] })
    const responseBody = await this.httpRequest('POST', '/minecraft/account-search', postData, {
      authorization: this.jwt ?? ''
    })

    try {
      const parsed = JSON.parse(responseBody) as {
        results?: { mcID?: string; status?: string }[]
      }

      if (!parsed.results || !Array.isArray(parsed.results) || parsed.results.length === 0) {
        return false
      }

      const match = parsed.results.find(
        (result) => result.mcID?.replaceAll('-', '').toLowerCase() === uuid.replaceAll('-', '').toLowerCase()
      )

      if (!match) return false

      return match.status?.toUpperCase() === 'ONLINE'
    } catch {
      return false
    }
  }

  private async httpRequest(
    method: 'GET' | 'POST',
    apiPath: string,
    postData?: string,
    extraHeaders?: Record<string, string>
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const parsed = new URL(FeatherApiBase)
      const fullPath = `/v1${apiPath}`

      /* eslint-disable @typescript-eslint/naming-convention */
      const headers: Record<string, string> = {
        'user-agent': UserAgentHeader,
        ...extraHeaders
      }

      if (postData) {
        headers['content-type'] = 'application/json'
        headers['content-length'] = Buffer.byteLength(postData).toString()
      }
      /* eslint-enable @typescript-eslint/naming-convention */

      const request = https.request(
        {
          hostname: parsed.hostname,
          path: fullPath,
          method,
          headers
        },
        (response) => {
          let body = ''
          response.on('data', (chunk: Buffer | string) => {
            body += chunk.toString()
          })
          response.on('end', () => {
            if (response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300) {
              resolve(body)
            } else {
              reject(new Error(`Feather API ${method} ${apiPath} returned HTTP ${response.statusCode}: ${body}`))
            }
          })
        }
      )

      request.on('error', reject)
      if (postData) request.write(postData)
      request.end()
    })
  }
}

function parseMaybeJsonString(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed
    }
  }
  return trimmed
}
