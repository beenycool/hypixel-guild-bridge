import assert from 'node:assert'

import type { DatabaseManager } from '../common/database-manager'
import { isValidTableName } from '../utility/input-validation.js'

export class ConfigurationsManager {
  private static readonly Tablename = 'configurations'
  private readonly createdCategories = new Set<string>()
  private readonly configurations = new Set<Configuration>()

  constructor(private readonly databaseManager: DatabaseManager) {}

  public create(category: string): Configuration {
    assert.ok(
      !this.createdCategories.has(category),
      'Category is already created and given out. Reuse the object if needed. Objects will not be given again to avoid race conditions.'
    )

    this.createdCategories.add(category)
    const configuration = new Configuration(this.databaseManager, ConfigurationsManager.Tablename, category)
    this.configurations.add(configuration)
    return configuration
  }

  public async load(): Promise<void> {
    await Promise.all(
      [...this.configurations].map(async (configuration) => {
        await configuration.load()
      })
    )
  }
}

export class Configuration {
  private readonly cache = new Map<string, unknown>()
  private readonly arrayCache = new Map<string, string[]>()
  private readonly setCache = new Map<string, Set<string>>()

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly tablename: string,
    private readonly category: string
  ) {
    if (!isValidTableName(tablename)) throw new Error(`Invalid table name: ${tablename}`)
  }

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<{ name: string; value: string }>(
      `SELECT "name", "value" FROM "${this.tablename}" WHERE "category" = $1`,
      [this.category]
    )

    this.cache.clear()
    this.arrayCache.clear()
    this.setCache.clear()
    for (const row of rows) {
      this.cache.set(row.name, row.value)
    }
  }

  public getStringArray(name: string, defaultValue: string[]): string[] {
    const cached = this.arrayCache.get(name)
    if (cached !== undefined) return cached

    const result = this.get(name, defaultValue, (raw) => JSON.parse(raw) as string[])
    this.arrayCache.set(name, result)
    return result
  }

  public getStringArraySet(name: string, defaultValue: string[]): Set<string> {
    const cached = this.setCache.get(name)
    if (cached !== undefined) return cached

    const array = this.getStringArray(name, defaultValue)
    const result = new Set(array)
    this.setCache.set(name, result)
    return result
  }

  public setStringArray(name: string, value: string[]) {
    this.set(name, value, (data) => JSON.stringify(data))
  }

  public getString(name: string, defaultValue: string): string {
    return this.get(name, defaultValue)
  }

  public setString(name: string, value: string): void {
    this.set(name, value)
  }

  public getNumber(name: string, defaultValue: number): number {
    return this.get(name, defaultValue, (raw: string | number) => {
      if (typeof raw === 'number') return raw
      const parsed = Number.parseFloat(raw)
      return Number.isNaN(parsed) ? defaultValue : parsed
    })
  }

  public setNumber(name: string, value: number): void {
    this.set(name, value)
  }

  public getBoolean(name: string, defaultValue: boolean): boolean {
    return this.get(name, defaultValue, (raw) => raw === '1')
  }

  public setBoolean(name: string, value: boolean): void {
    this.set(name, value, (data) => (data ? '1' : '0'))
  }

  public delete(name: string): boolean {
    if (!isValidTableName(this.tablename)) throw new Error(`Invalid table name: ${this.tablename}`)
    const existed = this.cache.delete(name)
    this.arrayCache.delete(name)
    this.setCache.delete(name)

    this.databaseManager.enqueueWrite(`deleting configuration ${this.category}.${name}`, async (database) => {
      await database.query(`DELETE FROM "${this.tablename}" WHERE "category" = $1 AND "name" = $2`, [
        this.category,
        name
      ])
    })

    return existed
  }

  /**
   * Get all cached configuration keys starting with the given prefix.
   */
  public keysWithPrefix(prefix: string): string[] {
    return [...this.cache.keys()].filter((key) => key.startsWith(prefix))
  }

  private get<T>(name: string, defaultValue: T, deserialize?: (raw: string) => T): T {
    const cached = this.cache.get(name)
    if (cached === undefined) return defaultValue

    if (deserialize === undefined) {
      return cached as T
    }

    assert.ok(typeof cached === 'string')
    return deserialize(cached)
  }

  private set<T>(name: string, value: T, serialize?: (value: T) => string): void {
    if (!isValidTableName(this.tablename)) throw new Error(`Invalid table name: ${this.tablename}`)
    const serializedValue = serialize === undefined ? String(value) : serialize(value)
    this.cache.set(name, serializedValue)
    this.arrayCache.delete(name)
    this.setCache.delete(name)

    this.databaseManager.enqueueWrite(`saving configuration ${this.category}.${name}`, async (database) => {
      await database.query(
        `INSERT INTO "${this.tablename}" ("category", "name", "value", "lastUpdatedAt") VALUES ($1, $2, $3, $4)
         ON CONFLICT ("category", "name") DO UPDATE SET
           "value" = EXCLUDED."value",
           "lastUpdatedAt" = EXCLUDED."lastUpdatedAt"`,
        [this.category, name, serializedValue, Math.floor(Date.now() / 1000)]
      )
    })
  }
}
