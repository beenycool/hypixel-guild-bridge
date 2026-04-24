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

    if (count !== 0) {
      this.logger.debug(`Deleted Minecraft sessions for name=${instanceName} (changes=${count})`)
    }
    this.logger.debug(`Remaining mojangSessions for ${instanceName} = ${this.sessions.get(key)?.size ?? 0}`)

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
      this.logger.debug(`Deleted ${deleted} Minecraft cached session files with the name=${instanceName}`)
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
    this.logger.debug(`setSession: name=${name} cacheName=${cacheName}`)

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
    this.logger.debug(`addInstance: inserted name=${options.name} proxyId=${String(proxyId)}`)
    this.logger.debug(`addInstance: total mojangInstances=${this.instances.size}`)

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
      this.logger.debug(
        `Deleted related proxy with the id=${instance.proxyId} to the Minecraft instance with the name=${instanceName} (changes=1)`
      )
    }
    this.logger.debug(`Deleted Minecraft instance with the name=${instanceName} (changes=1)`)
    this.logger.debug(`deleteInstance: remaining mojangInstances=${this.instances.size}`)

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
          const trimmed = jsonData.trim()
          const hasTopLevelCommas = trimmed.startsWith('{') && trimmed.match(/,"[^"]+":/g)
          const hasConcatenatedObjects = trimmed.match(/\}\s*\{/g)
          const isSingleObject =
            hasTopLevelCommas &&
            (hasConcatenatedObjects === null || hasTopLevelCommas.length > hasConcatenatedObjects.length)

          let fixedParsed: Record<string, unknown> | undefined
          const fixedJson = this.tryFixJson(jsonData)
          if (fixedJson !== jsonData) {
            try {
              fixedParsed = JSON.parse(fixedJson) as Record<string, unknown>
              errors.push('Fixed JSON formatting issues (added missing closing braces)')
            } catch {
              // ignore
            }
          }

          if (!fixedParsed && (isSingleObject || trimmed.startsWith('{'))) {
            const moreFixedJson = this.tryFixJsonAggressive(trimmed)
            if (moreFixedJson !== trimmed) {
              try {
                fixedParsed = JSON.parse(moreFixedJson) as Record<string, unknown>
                errors.push('Fixed JSON formatting issues (added missing closing braces)')
              } catch {
                // ignore
              }
            }
          }

          if (fixedParsed) {
            parsedData = fixedParsed
          } else if (!isSingleObject && hasConcatenatedObjects) {
            parsedData = this.parseConcatenatedJsonObjects(jsonData, errors)
            if (Object.keys(parsedData).length === 0) {
              return { imported, errors }
            }
          } else {
            if (isSingleObject) {
              const normalized = trimmed
                .replace(/^\uFEFF/, '')
                .replaceAll(/[\u200B-\u200D\uFEFF]/g, '')
                .trim()

              if (normalized === trimmed) {
                const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError)
                errors.push(`Failed to parse JSON: ${parseErrorMessage}`)
                return { imported, errors }
              } else {
                try {
                  parsedData = JSON.parse(normalized) as Record<string, unknown>
                  errors.push('Fixed JSON formatting issues (removed invisible characters)')
                } catch {
                  const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError)
                  errors.push(`Failed to parse JSON: ${parseErrorMessage}`)
                  return { imported, errors }
                }
              }
            } else {
              const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError)
              errors.push(`Failed to parse JSON: ${parseErrorMessage}`)
              return { imported, errors }
            }
          }
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
            this.logger.debug(`Skipping nested property "${cacheName}" that was incorrectly extracted as a cache entry`)
            continue
          }

          this.setSession(instanceName, username, cacheName, cacheValue as Record<string, unknown>)
          imported.push(cacheName)
          this.logger.debug(`Imported cache "${cacheName}" for instance "${instanceName}"`)
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

  private looksLikeSingleObject(jsonString: string): boolean {
    let depth = 0
    let inString = false
    let escapeNext = false
    let topLevelCommas = 0
    let hasMultipleKeys = false

    for (const char of jsonString) {
      if (escapeNext) {
        escapeNext = false
        continue
      }

      if (char === '\\') {
        escapeNext = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (!inString) {
        if (char === '{' || char === '[') {
          depth++
        } else if (char === '}' || char === ']') {
          depth--
        } else if (char === ',' && depth === 1) {
          topLevelCommas++
          hasMultipleKeys = true
        }
      }
    }

    return hasMultipleKeys && topLevelCommas > 0
  }

  private tryFixJsonAggressive(jsonString: string): string {
    const trimmed = jsonString.trim()
    if (!trimmed.startsWith('{')) {
      return jsonString
    }

    let depth = 0
    let inString = false
    let escapeNext = false
    let lastNonWhitespacePos = -1

    let index = 0
    for (const char of trimmed) {
      if (escapeNext) {
        escapeNext = false
        if (!/\s/.test(char)) {
          lastNonWhitespacePos = index
        }
        index++
        continue
      }

      if (char === '\\') {
        escapeNext = true
        index++
        continue
      }

      if (char === '"') {
        inString = !inString
        lastNonWhitespacePos = index
        index++
        continue
      }

      if (!inString) {
        if (char === '{') {
          depth++
          lastNonWhitespacePos = index
        } else if (char === '}') {
          depth--
          lastNonWhitespacePos = index
        } else if (!/\s/.test(char)) {
          lastNonWhitespacePos = index
        }
      } else if (!/\s/.test(char)) {
        lastNonWhitespacePos = index
      }
      index++
    }

    if (depth > 0 && depth <= 10 && lastNonWhitespacePos >= 0 && !inString) {
      const lastChar = trimmed[lastNonWhitespacePos]
      const canClose =
        (lastChar === '}' ||
          lastChar === '"' ||
          lastChar === ']' ||
          (lastChar >= '0' && lastChar <= '9') ||
          lastChar === 'e' ||
          lastChar === 'E' ||
          /(true|false|null)$/.exec(trimmed.slice(Math.max(0, lastNonWhitespacePos - 4), lastNonWhitespacePos + 1))) ??
        lastChar === ','

      if (canClose) {
        let fixed = trimmed.slice(0, Math.max(0, lastNonWhitespacePos + 1)).replace(/,\s*$/, '')
        fixed += '}'.repeat(depth)
        return fixed
      }
    }

    return jsonString
  }

  private tryFixJson(jsonString: string): string {
    const trimmed = jsonString.trim()
    if (!trimmed.startsWith('{')) {
      return jsonString
    }

    let depth = 0
    let inString = false
    let escapeNext = false

    for (const char of trimmed) {
      if (escapeNext) {
        escapeNext = false
        continue
      }

      if (char === '\\') {
        escapeNext = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (!inString) {
        if (char === '{') {
          depth++
        } else if (char === '}') {
          depth--
        }
      }
    }

    if (depth > 0 && depth <= 10) {
      let fixed = trimmed.replace(/,\s*$/, '')
      fixed += '}'.repeat(depth)
      return fixed
    }

    return jsonString
  }

  private parseConcatenatedJsonObjects(jsonString: string, errors: string[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {}
    let position = 0
    const trimmed = jsonString.trim()
    let objectCount = 0

    while (position < trimmed.length) {
      while (position < trimmed.length && /\s/.test(trimmed[position])) {
        position++
      }

      if (position >= trimmed.length) {
        break
      }

      if (trimmed[position] !== '{') {
        const nextBrace = trimmed.indexOf('{', position)
        if (nextBrace === -1) {
          if (objectCount === 0) {
            errors.push(`Unexpected character at position ${position}: expected '{'`)
          }
          break
        }
        const skipped = trimmed.slice(position, nextBrace).trim()
        if (skipped.length > 0 && !/^[,:]\s*$/.test(skipped)) {
          errors.push(
            `Skipped unexpected content between JSON objects: "${skipped.slice(0, 50)}${skipped.length > 50 ? '...' : ''}"`
          )
        }
        position = nextBrace
      }

      let depth = 0
      const startPos = position
      let inString = false
      let escapeNext = false
      let foundEnd = false

      for (let index = position; index < trimmed.length; index++) {
        const char = trimmed[index]

        if (escapeNext) {
          escapeNext = false
          continue
        }

        if (char === '\\') {
          escapeNext = true
          continue
        }

        if (char === '"') {
          inString = !inString
          continue
        }

        if (!inString) {
          if (char === '{') {
            depth++
          } else if (char === '}') {
            depth--
            if (depth === 0) {
              const jsonObjectString = trimmed.slice(startPos, index + 1)
              try {
                const parsed = JSON.parse(jsonObjectString) as Record<string, unknown>
                Object.assign(merged, parsed)
                objectCount++
              } catch (parseError) {
                const errorMessage = parseError instanceof Error ? parseError.message : String(parseError)
                errors.push(`Failed to parse JSON object at position ${startPos}: ${errorMessage}`)
              }
              position = index + 1
              foundEnd = true
              break
            }
          }
        }
      }

      if (!foundEnd) {
        if (depth === 0) {
          break
        } else {
          const endPos = Math.min(startPos + 200, trimmed.length)
          const partial = trimmed.slice(startPos, endPos)
          const objectPreview = partial.slice(0, 100)
          const cacheNameMatch = /"([^"]+)":\s*\{/.exec(partial)
          const cacheName = cacheNameMatch ? cacheNameMatch[1] : 'unknown'
          const isNearEnd = position >= trimmed.length - 100
          const truncationWarning = isNearEnd
            ? " The JSON appears to be truncated (likely due to Discord's 4000 character limit). Consider splitting your cache entries into multiple imports."
            : ''

          errors.push(
            `Unclosed JSON object "${cacheName}" starting at position ${startPos} (missing ${depth} closing brace${depth > 1 ? 's' : ''}).${truncationWarning} ` +
              `Partial content: "${objectPreview}${objectPreview.length < 100 ? '' : '...'}"`
          )

          if (isNearEnd && depth > 0 && depth <= 10) {
            const healedJson = trimmed.slice(Math.max(0, startPos)) + '}'.repeat(depth)
            try {
              const parsed = JSON.parse(healedJson) as Record<string, unknown>
              Object.assign(merged, parsed)
              objectCount++
              errors.pop()
              errors.push(
                `Recovered partial data for "${cacheName}" by closing ${depth} missing brace${depth > 1 ? 's' : ''}. Data may be incomplete due to truncation.`
              )
              break
            } catch {
              // ignore
            }
          } else {
            const nextBrace = trimmed.indexOf('{', position + 1)
            if (nextBrace === -1 || nextBrace === position) {
              break
            }
            position = nextBrace
          }
        }
      }
    }

    return merged
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

    const result = this.sessionsManager.deleteSingleCache(this.name, this.cacheName)
    if (result !== 0) {
      this.logger.debug(`Deleted sessions for name=${this.name} and cacheName=${this.cacheName}`)
    }
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
    this.sessionsManager.setSession(this.instanceName, this.name, this.cacheName, { partial, ...value })
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
