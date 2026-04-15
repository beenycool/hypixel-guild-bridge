import assert from 'node:assert'

import type { DatabaseManager } from '../common/database-manager'

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
    await Promise.all([...this.configurations].map(async (configuration) => await configuration.load()))
  }
}

export class Configuration {
  private readonly cache = new Map<string, unknown>()

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly tablename: string,
    private readonly category: string
  ) {}

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<{ name: string; value: string }>(
      `SELECT "name", "value" FROM "${this.tablename}" WHERE "category" = $1`,
      [this.category]
    )

    this.cache.clear()
    for (const row of rows) {
      this.cache.set(row.name, row.value)
    }
  }

  public getStringArray(name: string, defaultValue: string[]): string[] {
    return this.get(name, defaultValue, (raw) => JSON.parse(raw) as string[])
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
    return this.get(name, defaultValue, (raw: string | number) =>
      typeof raw === 'number' ? raw : Number.parseInt(raw, 10)
    )
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
    const existed = this.cache.delete(name)

    this.databaseManager.enqueueWrite(`deleting configuration ${this.category}.${name}`, async (database) => {
      await database.query(`DELETE FROM "${this.tablename}" WHERE "category" = $1 AND "name" = $2`, [
        this.category,
        name
      ])
    })

    return existed
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
    const serializedValue = serialize === undefined ? String(value) : serialize(value)
    this.cache.set(name, serializedValue)

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
