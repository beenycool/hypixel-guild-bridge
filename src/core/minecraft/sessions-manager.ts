import assert from 'node:assert'

import type { Logger } from 'log4js'
import type { Cache, CacheFactory } from 'prismarine-auth'

import type { DatabaseManager } from '../../common/database-manager'

export class SessionsManager {
  private readonly proxies = new Map<number, ProxyConfig>()
  private readonly instances = new Map<string, LoadedMinecraftInstance>()
  private readonly sessions = new Map<string, Map<string, StoredSession>>()
  private nextProxyId = 1

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly logger: Logger
  ) {}

  public async load(): Promise<void> {
    const proxies = await this.databaseManager.queryRows<ProxyConfig>('SELECT * FROM "proxies" ORDER BY "id" ASC')
    const instances = await this.databaseManager.queryRows<StoredMinecraftInstance>(
      'SELECT * FROM "mojangInstances" ORDER BY "name" ASC'
    )
    const sessions = await this.databaseManager.queryRows<StoredSession>(
      'SELECT * FROM "mojangSessions" ORDER BY "name" ASC, "cacheName" ASC'
    )

    this.proxies.clear()
    for (const proxy of proxies) {
      this.proxies.set(proxy.id, { ...proxy, user: proxy.user ?? undefined, password: proxy.password ?? undefined })
    }
    let maxProxyId = 0
    for (const proxy of proxies) {
      if (proxy.id > maxProxyId) maxProxyId = proxy.id
    }
    this.nextProxyId = maxProxyId + 1

    this.instances.clear()
    for (const instance of instances) {
      this.instances.set(instanceKey(instance.name), {
        name: instance.name,
        proxyId: instance.proxyId ?? undefined,
        connect: instance.connect !== 0
      })
    }

    this.sessions.clear()
    for (const session of sessions) {
      const sessionMap = getOrCreate(this.sessions, sessionKey(session.name), () => new Map())
      sessionMap.set(session.cacheName, { ...session })
    }
  }

  public getSessionsFactory(instanceName: string): CacheFactory {
    return (options: { username: string; cacheName: string }): Cache => {
      return new Session(this, this.logger, instanceName, options.username, options.cacheName)
    }
  }

  public deleteSession(instanceName: string): number {
    const key = sessionKey(instanceName)
    const count = this.sessions.get(key)?.size ?? 0
    this.sessions.delete(key)

    this.databaseManager.enqueueWrite(`deleting sessions for ${instanceName}`, async (database) => {
      await database.query('DELETE FROM "mojangSessions" WHERE LOWER("name") = LOWER($1)', [instanceName])
    })

    return count
  }

  public clearCachedSessions(instanceName: string): number {
    const mainSessionName = 'live'
    const sessionMap = this.sessions.get(sessionKey(instanceName))
    if (sessionMap === undefined) return 0

    let deleted = 0
    for (const cacheName of sessionMap.keys()) {
      if (cacheName !== mainSessionName) {
        sessionMap.delete(cacheName)
        deleted++
      }
    }

    if (deleted !== 0) {
      this.databaseManager.enqueueWrite(`deleting cached sessions for ${instanceName}`, async (database) => {
        await database.query('DELETE FROM "mojangSessions" WHERE LOWER("name") = LOWER($1) AND "cacheName" != $2', [
          instanceName,
          mainSessionName
        ])
      })
    }

    return deleted
  }

  public setSession(instanceName: string, name: string, cacheName: string, value: Record<string, unknown>): void {
    const createdAt = Math.floor(Date.now() / 1000)
    const sessionMap = getOrCreate(this.sessions, sessionKey(name), () => new Map())
    sessionMap.set(cacheName, { name, cacheName, value: JSON.stringify(value), createdAt })

    this.databaseManager.enqueueWrite(`saving session ${name}:${cacheName}`, async (database) => {
      await database.query(
        'DELETE FROM "mojangSessions" WHERE LOWER("name") = LOWER($1) AND "cacheName" = $2 AND "name" != $1',
        [name, cacheName]
      )
      await database.query(
        `INSERT INTO "mojangSessions" ("name", "cacheName", "value", "createdAt") VALUES ($1, $2, $3, $4)
         ON CONFLICT ("name", "cacheName") DO UPDATE SET
           "value" = EXCLUDED."value",
           "createdAt" = EXCLUDED."createdAt"`,
        [name, cacheName, JSON.stringify(value), createdAt]
      )
    })
  }

  public setInstanceAutoConnect(instanceName: string, enabled: boolean): void {
    const instance = this.instances.get(instanceKey(instanceName))
    assert.ok(instance !== undefined, 'Did not manage to change the instance auto-connect settings?')
    instance.connect = enabled

    this.databaseManager.enqueueWrite(`updating auto-connect for ${instanceName}`, async (database) => {
      await database.query('UPDATE "mojangInstances" SET "connect" = $1 WHERE LOWER("name") = LOWER($2)', [
        enabled ? 1 : 0,
        instanceName
      ])
    })
  }

  public getInstanceAutoConnect(instanceName: string): boolean {
    return this.instances.get(instanceKey(instanceName))?.connect ?? true
  }

  public getAllInstances(): readonly MinecraftInstanceConfig[] {
    return [...this.instances.values()].map((instance) => ({
      name: instance.name,
      proxy: instance.proxyId === undefined ? undefined : this.proxies.get(instance.proxyId)
    }))
  }

  public getInstance(instanceName: string): MinecraftInstanceConfig | undefined {
    const instance = this.instances.get(instanceKey(instanceName))
    if (instance === undefined) return undefined

    return {
      name: instance.name,
      proxy: instance.proxyId === undefined ? undefined : this.proxies.get(instance.proxyId)
    }
  }

  public addInstance(options: MinecraftInstanceConfig): void {
    let proxyId: number | undefined
    if (options.proxy !== undefined) {
      proxyId = options.proxy.id || this.nextProxyId++
      this.proxies.set(proxyId, { ...options.proxy, id: proxyId })
    }

    this.instances.set(instanceKey(options.name), { name: options.name, proxyId, connect: true })

    this.databaseManager.enqueueTransaction(`adding minecraft instance ${options.name}`, async (database) => {
      const duplicateInstances = await database.query<{ name: string; proxyId: number | null }>(
        'SELECT "name", "proxyId" FROM "mojangInstances" WHERE LOWER("name") = LOWER($1) AND "name" != $1',
        [options.name]
      )

      if (duplicateInstances.rowCount !== 0) {
        await database.query('DELETE FROM "mojangInstances" WHERE LOWER("name") = LOWER($1) AND "name" != $1', [
          options.name
        ])
        for (const duplicate of duplicateInstances.rows) {
          if (duplicate.proxyId !== null && duplicate.proxyId !== proxyId) {
            await database.query('DELETE FROM "proxies" WHERE "id" = $1', [duplicate.proxyId])
          }
        }
      }

      if (options.proxy !== undefined && proxyId !== undefined) {
        await database.query(
          `INSERT INTO "proxies" ("id", "protocol", "host", "port", "user", "password", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT ("id") DO UPDATE SET
             "protocol" = EXCLUDED."protocol",
             "host" = EXCLUDED."host",
             "port" = EXCLUDED."port",
             "user" = EXCLUDED."user",
             "password" = EXCLUDED."password"`,
          [
            proxyId,
            options.proxy.protocol,
            options.proxy.host,
            options.proxy.port,
            options.proxy.user ?? undefined,
            options.proxy.password ?? undefined,
            Math.floor(Date.now() / 1000)
          ]
        )
      }

      await database.query(
        `INSERT INTO "mojangInstances" ("name", "proxyId", "connect") VALUES ($1, $2, $3)
         ON CONFLICT ("name") DO UPDATE SET
           "proxyId" = EXCLUDED."proxyId",
           "connect" = EXCLUDED."connect"`,
        [options.name, proxyId ?? undefined, 1]
      )
    })
  }

  public deleteInstance(instanceName: string): number {
    const key = instanceKey(instanceName)
    const instance = this.instances.get(key)
    if (instance === undefined) return 0

    this.instances.delete(key)
    if (instance.proxyId !== undefined) {
      this.proxies.delete(instance.proxyId)
    }

    this.databaseManager.enqueueTransaction(`deleting minecraft instance ${instanceName}`, async (database) => {
      await database.query('DELETE FROM "mojangInstances" WHERE LOWER("name") = LOWER($1)', [instance.name])
      if (instance.proxyId !== undefined) {
        await database.query('DELETE FROM "proxies" WHERE "id" = $1', [instance.proxyId])
      }
    })

    return 1
  }

  public deleteSingleCache(name: string, cacheName: string): number {
    const sessionMap = this.sessions.get(sessionKey(name))
    const deleted = sessionMap?.delete(cacheName) ? 1 : 0

    this.databaseManager.enqueueWrite(`deleting session cache ${name}:${cacheName}`, async (database) => {
      await database.query('DELETE FROM "mojangSessions" WHERE LOWER("name") = LOWER($1) AND "cacheName" = $2', [
        name,
        cacheName
      ])
    })

    return deleted
  }

  public getCacheSync(name: string, cacheName: string): Record<string, unknown> {
    const result = this.sessions.get(sessionKey(name))?.get(cacheName)?.value
    return result === undefined ? {} : (JSON.parse(result) as Record<string, unknown>)
  }

  public importAuthCache(
    instanceName: string,
    username: string,
    jsonData: string | Record<string, unknown>
  ): { imported: string[]; errors: string[] } {
    const imported: string[] = []
    const errors: string[] = []

    try {
      let parsedData: Record<string, unknown>

      if (typeof jsonData === 'string') {
        try {
          parsedData = JSON.parse(jsonData) as Record<string, unknown>
        } catch (parseError) {
          const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError)
          errors.push(`Failed to parse JSON: ${parseErrorMessage}`)
          return { imported, errors }
        }
      } else {
        parsedData = jsonData
      }

      for (const [cacheName, cacheValue] of Object.entries(parsedData)) {
        try {
          if (typeof cacheValue !== 'object' || cacheValue === null || Array.isArray(cacheValue)) {
            if (cacheName.length > 2 && !/^(IssueInstant|NotAfter|Token|DisplayClaims)$/i.test(cacheName)) {
              errors.push(`Skipping invalid cache entry "${cacheName}": value must be an object`)
            }
            continue
          }

          const nestedPropertyNames = [
            'IssueInstant',
            'NotAfter',
            'Token',
            'DisplayClaims',
            'xui',
            'xdi',
            'xti',
            'uhs',
            'did',
            'dcs',
            'tid'
          ]
          if (nestedPropertyNames.includes(cacheName)) {
            continue
          }

          this.setSession(instanceName, username, cacheName, cacheValue as Record<string, unknown>)
          imported.push(cacheName)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          errors.push(`Failed to import cache "${cacheName}": ${errorMessage}`)
          this.logger.warn(`Failed to import cache "${cacheName}" for instance "${instanceName}":`, error)
        }
      }

      if (imported.length > 0) {
        this.logger.info(
          `Imported ${imported.length} cache entries for instance "${instanceName}": ${imported.join(', ')}`
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errors.push(`Failed to parse JSON: ${errorMessage}`)
      this.logger.error(`Failed to import auth cache for instance "${instanceName}":`, error)
    }

    return { imported, errors }
  }
}

interface StoredMinecraftInstance {
  name: string
  proxyId: number | null
  connect: number
}

interface LoadedMinecraftInstance {
  name: string
  proxyId: number | undefined
  connect: boolean
}

interface StoredSession {
  name: string
  cacheName: string
  value: string
  createdAt: number
}

export interface MinecraftInstanceConfig {
  name: string
  proxy: ProxyConfig | undefined
}

export interface ProxyConfig {
  id: number
  host: string
  port: number
  user: string | undefined
  password: string | undefined
  protocol: ProxyProtocol
}

export enum ProxyProtocol {
  Http = 'http',
  Socks5 = 'socks5'
}

class Session implements Cache {
  constructor(
    private readonly sessionsManager: SessionsManager,
    private readonly logger: Logger,
    readonly instanceName: string,
    readonly name: string,
    readonly cacheName: string
  ) {}

  async reset(): Promise<void> {
    await Promise.resolve()

    this.sessionsManager.deleteSingleCache(this.name, this.cacheName)
  }

  async getCached(): Promise<Record<string, unknown>> {
    await Promise.resolve()
    return this.sessionsManager.getCacheSync(this.name, this.cacheName)
  }

  async setCached(value: Record<string, unknown>): Promise<void> {
    await Promise.resolve()
    this.sessionsManager.setSession(this.instanceName, this.name, this.cacheName, value)
  }

  async setCachedPartial(value: Record<string, unknown>): Promise<void> {
    await Promise.resolve()

    const partial = this.sessionsManager.getCacheSync(this.name, this.cacheName)
    this.sessionsManager.setSession(this.instanceName, this.name, this.cacheName, { ...partial, ...value })
  }
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key)
  if (existing !== undefined) return existing

  const value = create()
  map.set(key, value)
  return value
}

function instanceKey(name: string): string {
  return name.toLowerCase()
}

function sessionKey(name: string): string {
  return name.toLowerCase()
}
