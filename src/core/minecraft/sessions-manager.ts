import assert from 'node:assert'

import type { Logger } from 'log4js'
import type { Cache, CacheFactory } from 'prismarine-auth'

import type { SqliteManager } from '../../common/sqlite-manager'

export class SessionsManager {
  constructor(
    private readonly sqliteManager: SqliteManager,
    private readonly logger: Logger
  ) {}

  public getSessionsFactory(instanceName: string): CacheFactory {
    return (options: { username: string; cacheName: string }): Cache => {
      return new Session(this, this.sqliteManager, this.logger, instanceName, options.username, options.cacheName)
    }
  }

  public deleteSession(instanceName: string): number {
    const database = this.sqliteManager.getDatabase()
    const transaction = database.transaction(() => {
      const statement = database.prepare('DELETE FROM "mojangSessions" WHERE name = ?')
      const result = statement.run(instanceName).changes
      if (result !== 0) {
        this.logger.debug(`Deleted Minecraft instance with the name=${instanceName}`)
      }

      return result
    })

    return transaction()
  }

  public clearCachedSessions(instanceName: string): number {
    const MainSessionName = 'live'

    const database = this.sqliteManager.getDatabase()
    const transaction = database.transaction(() => {
      const statement = database.prepare('DELETE FROM "mojangSessions" WHERE name = ? AND cacheName != ?')
      const result = statement.run(instanceName, MainSessionName).changes
      if (result !== 0) {
        this.logger.debug(`Deleted ${result} Minecraft cached session files with the name=${instanceName}`)
      }

      return result
    })

    return transaction()
  }

  public setSession(instanceName: string, name: string, cacheName: string, value: Record<string, unknown>): void {
    const database = this.sqliteManager.getDatabase()
    const statement = database.prepare(
      'INSERT OR REPLACE INTO "mojangSessions" (name, cacheName, value, createdAt) VALUES (?, ?, ?, ?)'
    )
    statement.run(name, cacheName, JSON.stringify(value), Math.floor(Date.now() / 1000))
  }

  public setInstanceAutoConnect(instanceName: string, enabled: boolean): void {
    const database = this.sqliteManager.getDatabase()
    const statement = database.prepare('UPDATE "mojangInstances" SET connect = ? WHERE name = ?')
    const result = statement.run(enabled ? '1' : '0', instanceName)
    assert.strictEqual(result.changes, 1, 'Did not manage to change the instance auto-connect settings?')
  }

  public getInstanceAutoConnect(instanceName: string): boolean {
    const database = this.sqliteManager.getDatabase()
    const statement = database.prepare('SELECT "connect" FROM  "mojangInstances" WHERE name = ?')
    const result = statement.pluck(true).get(instanceName) as number | undefined
    return result === undefined ? true : result === 1
  }

  public getAllInstances(): readonly MinecraftInstanceConfig[] {
    const database = this.sqliteManager.getDatabase()
    const transaction = database.transaction(() => {
      const selectInstance = database.prepare('SELECT * FROM "mojangInstances"')
      const selectProxy = database.prepare('SELECT * FROM "proxies" WHERE id = ?')

      const foundInstances = selectInstance.all() as MojangInstance[]

      const instances = new Map<string, MinecraftInstanceConfig>()
      for (const instance of foundInstances) {
        const proxy = instance.proxyId === undefined ? undefined : (selectProxy.get(instance.proxyId) as ProxyConfig)
        instances.set(instance.name, { name: instance.name, proxy: proxy })
      }

      return instances.values().toArray()
    })

    return transaction()
  }

  public getInstance(instanceName: string): MinecraftInstanceConfig | undefined {
    const database = this.sqliteManager.getDatabase()
    const transaction = database.transaction(() => {
      const selectInstance = database.prepare('SELECT * FROM "mojangInstances" WHERE name = ?')
      const instance = selectInstance.get(instanceName) as MojangInstance | undefined
      if (!instance) return

      let proxy: ProxyConfig | undefined
      if (instance.proxyId !== undefined) {
        const selectProxy = database.prepare('SELECT * FROM "proxies" WHERE id = ?')
        proxy = selectProxy.get(instance.proxyId) as ProxyConfig | undefined
      }

      return { name: instance.name, proxy: proxy }
    })

    return transaction()
  }

  public addInstance(options: MinecraftInstanceConfig): void {
    const database = this.sqliteManager.getDatabase()
    const transaction = database.transaction(() => {
      const proxy = database.prepare(
        'INSERT INTO "proxies" (protocol, host, port, user, password) VALUES (?, ?, ?, ?, ?)'
      )
      let proxyId: number | bigint | undefined
      if (options.proxy !== undefined) {
        proxyId = proxy.run(
          options.proxy.protocol,
          options.proxy.host,
          options.proxy.port,
          options.proxy.user,
          options.proxy.password
        ).lastInsertRowid
      }

      const instance = database.prepare('INSERT INTO "mojangInstances" (name, proxyId) VALUES (?, ?)')
      instance.run(options.name, proxyId)
    })

    transaction()
  }

  public deleteInstance(instanceName: string): number {
    const database = this.sqliteManager.getDatabase()
    const transaction = database.transaction(() => {
      const instance = this.getInstance(instanceName)
      if (instance == undefined) return 0

      const statement = database.prepare('DELETE FROM "mojangInstances" WHERE name = ?')
      const result = statement.run(instance.name).changes
      if (result !== 0) {
        this.logger.debug(`Deleted Minecraft instance with the name=${instanceName}`)
      }

      if (instance.proxy !== undefined) {
        const statement = database.prepare('DELETE FROM "proxies" WHERE id = ?')
        const result = statement.run(instance.proxy.id).changes
        if (result !== 0) {
          this.logger.debug(
            `Deleted related proxy with the id=${instance.proxy.id} to the Minecraft instance with the name=${instanceName}`
          )
        }
      }

      return result
    })

    return transaction()
  }

  /**
   * Import Microsoft authentication cache from JSON data.
   * The JSON should be an object where keys are cache names (e.g., "token", "mca", "userToken", etc.)
   * and values are the cache data objects.
   * Also supports multiple JSON objects concatenated together (e.g., {"token":{...}}{"mca":{...}}).
   *
   * @param instanceName The Minecraft instance name
   * @param username The username for the session (typically the instance name)
   * @param jsonData JSON string or object containing cache data
   * @returns Object with imported cache names and any errors
   */
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
        // First, try parsing as a single JSON object
        try {
          parsedData = JSON.parse(jsonData) as Record<string, unknown>
        } catch (parseError) {
          const trimmed = jsonData.trim()
          // Check if this looks like a single object (has top-level comma-separated keys)
          // Pattern: starts with {, contains ","key": patterns which indicate multiple top-level keys
          const hasTopLevelCommas = trimmed.startsWith('{') && trimmed.match(/,"[^"]+":/g)
          const hasConcatenatedObjects = trimmed.match(/\}\s*\{/g)
          const isSingleObject =
            hasTopLevelCommas !== null &&
            (hasConcatenatedObjects === null || hasTopLevelCommas.length > hasConcatenatedObjects.length)

          // If that fails, try to fix common issues and parse again
          let fixedParsed: Record<string, unknown> | undefined
          const fixedJson = this.tryFixJson(jsonData)
          if (fixedJson !== jsonData) {
            try {
              fixedParsed = JSON.parse(fixedJson) as Record<string, unknown>
              errors.push('Fixed JSON formatting issues (added missing closing braces)')
            } catch {
              // Fixed version also failed, continue to alternative parsers
            }
          }

          // If single object parsing still failed, try more aggressive fixing
          if (!fixedParsed && (isSingleObject || trimmed.startsWith('{'))) {
            // Try aggressive fixing for single object
            const moreFixedJson = this.tryFixJsonAggressive(trimmed)
            if (moreFixedJson !== trimmed) {
              try {
                fixedParsed = JSON.parse(moreFixedJson) as Record<string, unknown>
                errors.push('Fixed JSON formatting issues (added missing closing braces)')
              } catch {
                // Still failed, will try concatenated parser below
              }
            }
          }

          // If single object parsing still failed, only try concatenated JSON objects
          // if it doesn't look like a single object (has multiple complete objects)
          if (fixedParsed) {
            parsedData = fixedParsed
          } else if (!isSingleObject && hasConcatenatedObjects) {
            // Only use concatenated parser if it looks like multiple objects
            parsedData = this.parseConcatenatedJsonObjects(jsonData, errors)
            if (Object.keys(parsedData).length === 0) {
              // If we couldn't parse anything, return early
              return { imported, errors }
            }
          } else {
            // It looks like a single object but we couldn't parse it
            // Try one more normalization attempt: remove any BOM or zero-width characters
            if (isSingleObject) {
              const normalized = trimmed
                .replace(/^\uFEFF/, '') // Remove BOM
                .replaceAll(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
                .trim()

              if (normalized === trimmed) {
                // Report the original error
                const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError)
                errors.push(`Failed to parse JSON: ${parseErrorMessage}`)
                return { imported, errors }
              } else {
                try {
                  parsedData = JSON.parse(normalized) as Record<string, unknown>
                  errors.push('Fixed JSON formatting issues (removed invisible characters)')
                } catch {
                  // Still failed, report the original error
                  const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError)
                  errors.push(`Failed to parse JSON: ${parseErrorMessage}`)
                  return { imported, errors }
                }
              }
            } else {
              // Report the original error
              const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError)
              errors.push(`Failed to parse JSON: ${parseErrorMessage}`)
              return { imported, errors }
            }
          }
        }
      } else {
        parsedData = jsonData
      }

      if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
        errors.push('Invalid JSON format: expected an object with cache entries')
        return { imported, errors }
      }

      // Import each cache entry
      // Only import top-level keys that are objects (cache entries)
      // Skip any nested properties that might have been incorrectly extracted
      for (const [cacheName, cacheValue] of Object.entries(parsedData)) {
        try {
          // Skip if value is not an object (strings, numbers, etc. are not valid cache entries)
          if (typeof cacheValue !== 'object' || cacheValue === null || Array.isArray(cacheValue)) {
            // Only report as error if it looks like it might have been a cache entry
            // (i.e., has a reasonable name, not something like "IssueInstant" which is clearly nested)
            if (cacheName.length > 2 && !/^(IssueInstant|NotAfter|Token|DisplayClaims)$/i.test(cacheName)) {
              errors.push(`Skipping invalid cache entry "${cacheName}": value must be an object`)
            }
            continue
          }

          // Additional validation: check if this looks like a nested property that was incorrectly extracted
          // Common nested property names that shouldn't be top-level cache entries
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
            // This is likely a nested property, skip it
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

  /**
   * Check if a string looks like a single JSON object (not concatenated objects).
   * A single object typically has multiple top-level keys separated by commas.
   *
   * @param jsonString The JSON string to check
   * @returns True if it looks like a single object
   */
  private looksLikeSingleObject(jsonString: string): boolean {
    // Count top-level commas (not inside nested objects/arrays/strings)
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
          // Top-level comma (depth 1 because we're inside the outer object)
          topLevelCommas++
          hasMultipleKeys = true
        }
      }
    }

    // If we have multiple top-level keys (commas at depth 1), it's likely a single object
    return hasMultipleKeys && topLevelCommas > 0
  }

  /**
   * More aggressive JSON fixing for single objects that are missing closing braces.
   * This handles cases where the entire object structure is malformed.
   *
   * @param jsonString The potentially malformed JSON string
   * @returns Fixed JSON string (or original if no fixes applied)
   */
  private tryFixJsonAggressive(jsonString: string): string {
    const trimmed = jsonString.trim()
    if (!trimmed.startsWith('{')) {
      return jsonString
    }

    // Count opening and closing braces to see if we're missing closing braces
    let depth = 0
    let inString = false
    let escapeNext = false
    let lastNonWhitespacePos = -1

    for (const [index, char] of trimmed.entries()) {
      if (escapeNext) {
        escapeNext = false
        if (!/\s/.test(char)) {
          lastNonWhitespacePos = index
        }
        continue
      }

      if (char === '\\') {
        escapeNext = true
        continue
      }

      if (char === '"') {
        inString = !inString
        lastNonWhitespacePos = index
        continue
      }

      if (inString) {
        if (!/\s/.test(char)) {
          lastNonWhitespacePos = index
        }
      } else {
        if (char === '{') {
          depth++
          lastNonWhitespacePos = index
        } else if (char === '}') {
          depth--
          lastNonWhitespacePos = index
        } else if (!/\s/.test(char)) {
          lastNonWhitespacePos = index
        }
      }
    }

    // If we have unclosed braces, try to close them
    if (
      depth > 0 &&
      depth <= 10 &&
      lastNonWhitespacePos >= 0 && // Check if we're not in the middle of a string (which would be bad)
      // If we're not in a string and depth > 0, we can try to close
      !inString
    ) {
      // Check if the last non-whitespace character suggests we can safely close
      const lastChar = trimmed[lastNonWhitespacePos]
      const canClose =
        lastChar === '}' ||
        lastChar === '"' ||
        lastChar === ']' ||
        (lastChar >= '0' && lastChar <= '9') || // number
        lastChar === 'e' ||
        lastChar === 'E' || // scientific notation end
        /(true|false|null)$/.exec(trimmed.substring(Math.max(0, lastNonWhitespacePos - 4), lastNonWhitespacePos + 1)) ||
        // If we end with a comma, we can close after removing it
        lastChar === ','

      if (canClose) {
        // Remove any trailing commas/whitespace before adding closing braces
        let fixed = trimmed.slice(0, Math.max(0, lastNonWhitespacePos + 1)).replace(/,\s*$/, '')
        // Add missing closing braces
        fixed += '}'.repeat(depth)
        return fixed
      }
    }

    return jsonString
  }

  /**
   * Try to fix common JSON issues like missing closing braces.
   * This is a best-effort attempt to recover from truncated or malformed JSON.
   *
   * @param jsonString The potentially malformed JSON string
   * @returns Fixed JSON string (or original if no fixes applied)
   */
  private tryFixJson(jsonString: string): string {
    const trimmed = jsonString.trim()
    if (!trimmed.startsWith('{')) {
      return jsonString
    }

    // Count opening and closing braces to see if we're missing closing braces
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

    // If we have unclosed braces, try to close them
    if (depth > 0 && depth <= 10) {
      // Remove any trailing commas before adding closing braces
      let fixed = trimmed.replace(/,\s*$/, '')
      // Add missing closing braces
      fixed += '}'.repeat(depth)
      return fixed
    }

    return jsonString
  }

  /**
   * Parse multiple concatenated JSON objects from a string.
   * Handles cases where multiple JSON objects are concatenated without separators (e.g., {"a":1}{"b":2}).
   * Also handles objects separated by whitespace or newlines.
   *
   * @param jsonString The string containing concatenated JSON objects
   * @param errors Array to append any parsing errors to
   * @returns Merged object containing all parsed cache entries
   */
  private parseConcatenatedJsonObjects(jsonString: string, errors: string[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {}
    let position = 0
    const trimmed = jsonString.trim()
    let objectCount = 0

    while (position < trimmed.length) {
      // Skip whitespace (including newlines, tabs, etc.)
      while (position < trimmed.length && /\s/.test(trimmed[position])) {
        position++
      }

      if (position >= trimmed.length) {
        break
      }

      // Find the start of a JSON object
      if (trimmed[position] !== '{') {
        // Try to find the next '{' instead of giving up
        const nextBrace = trimmed.indexOf('{', position)
        if (nextBrace === -1) {
          // No more JSON objects found
          if (objectCount === 0) {
            errors.push(`Unexpected character at position ${position}: expected '{'`)
          }
          break
        }
        // Skip unexpected characters and try again
        const skipped = trimmed.substring(position, nextBrace).trim()
        if (skipped.length > 0 && !/^[,:]\s*$/.test(skipped)) {
          // Only report non-trivial skipped content (not just commas/colons)
          errors.push(
            `Skipped unexpected content between JSON objects: "${skipped.slice(0, 50)}${skipped.length > 50 ? '...' : ''}"`
          )
        }
        position = nextBrace
      }

      // Find the matching closing brace by tracking brace depth
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
              // Found the end of this JSON object
              const jsonObjectString = trimmed.substring(startPos, index + 1)
              try {
                const parsed = JSON.parse(jsonObjectString) as Record<string, unknown>
                // Merge into the result object
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

      // If we didn't find a matching closing brace, try to continue with next object
      if (!foundEnd) {
        if (depth === 0) {
          // Should not happen, but break to avoid infinite loop
          break
        } else {
          // Try to extract more context for better error reporting
          const endPos = Math.min(startPos + 200, trimmed.length)
          const partial = trimmed.substring(startPos, endPos)
          const objectPreview = partial.slice(0, 100)

          // Try to identify which cache entry this is
          const cacheNameMatch = /"([^"]+)":\s*\{/.exec(partial)
          const cacheName = cacheNameMatch ? cacheNameMatch[1] : 'unknown'

          // Check if we're near the end of the string (likely truncated)
          const isNearEnd = position >= trimmed.length - 100
          const truncationWarning = isNearEnd
            ? " The JSON appears to be truncated (likely due to Discord's 4000 character limit). Consider splitting your cache entries into multiple imports."
            : ''

          errors.push(
            `Unclosed JSON object "${cacheName}" starting at position ${startPos} (missing ${depth} closing brace${depth > 1 ? 's' : ''}).${truncationWarning} ` +
              `Partial content: "${objectPreview}${objectPreview.length < 100 ? '' : '...'}"`
          )

          // If we're at the end of the string and depth is reasonable, try to heal by closing braces
          if (isNearEnd && depth > 0 && depth <= 10) {
            const healedJson = trimmed.slice(Math.max(0, startPos)) + '}'.repeat(depth)
            try {
              const parsed = JSON.parse(healedJson) as Record<string, unknown>
              Object.assign(merged, parsed)
              objectCount++
              // Replace the error with a warning about truncation
              errors.pop()
              errors.push(
                `Recovered partial data for "${cacheName}" by closing ${depth} missing brace${depth > 1 ? 's' : ''}. ` +
                  `Data may be incomplete due to truncation.`
              )
              break // We've reached the end
            } catch {
              // Healing failed, keep the original error
            }
          } else {
            // Try to find the next '{' to continue parsing other objects
            const nextBrace = trimmed.indexOf('{', position + 1)
            if (nextBrace === -1 || nextBrace === position) {
              // No more objects to parse
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

interface MojangInstance {
  name: string
  proxyId: number | undefined
}

export interface MinecraftInstanceConfig {
  name: string
  proxy: ProxyConfig | undefined
}

export interface ProxyConfig {
  /** only set if fetched from database */
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
    private readonly sqliteManager: SqliteManager,
    private readonly logger: Logger,
    readonly instanceName: string,
    readonly name: string,
    readonly cacheName: string
  ) {}

  async reset(): Promise<void> {
    await Promise.resolve() // require async/await per interface definition

    const database = this.sqliteManager.getDatabase()
    const statement = database.prepare('DELETE FROM "mojangSessions" WHERE name = ? AND cacheName = ?')
    const result = statement.run(this.name, this.cacheName).changes
    if (result !== 0) {
      this.logger.debug(`Deleted sessions for name=${this.name} and cacheName=${this.cacheName}`)
    }
  }

  async getCached(): Promise<Record<string, unknown>> {
    await Promise.resolve() // require async/await per interface definition
    return this.getCacheSync()
  }

  private getCacheSync(): Record<string, unknown> {
    const database = this.sqliteManager.getDatabase()
    const statement = database.prepare('SELECT value FROM "mojangSessions" WHERE name = ? AND cacheName = ?')
    const result = statement.pluck(true).get(this.name, this.cacheName) as string | undefined
    return result === undefined ? {} : (JSON.parse(result) as Record<string, unknown>)
  }

  async setCached(value: Record<string, unknown>): Promise<void> {
    await Promise.resolve() // require async/await per interface definition
    this.setCachedSync(value)
  }

  private setCachedSync(value: Record<string, unknown>): void {
    this.sessionsManager.setSession(this.instanceName, this.name, this.cacheName, value)
  }

  async setCachedPartial(value: Record<string, unknown>): Promise<void> {
    await Promise.resolve() // require async/await per interface definition

    const transaction = this.sqliteManager.getDatabase().transaction(() => {
      const partial = this.getCacheSync()
      this.setCachedSync({ partial, ...value })
    })

    transaction()
  }
}
