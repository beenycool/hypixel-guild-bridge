import assert from 'node:assert'

import type { Logger } from 'log4js'

import type { ApplicationConfig } from '../application-config.js'
import type { DatabaseManager } from '../common/database-manager'

export class AppSettingsManager {
  private static readonly TableName = 'app_settings'

  private readonly cache = new Map<string, string>()

  public constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly config: ApplicationConfig,
    private readonly logger: Logger
  ) {}

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<{ key: string; value: string }>(
      `SELECT "key", "value" FROM "${AppSettingsManager.TableName}"`
    )
    this.cache.clear()
    for (const row of rows) {
      this.cache.set(row.key, row.value)
    }
  }

  public getUrchinApiKey(): string | undefined {
    return this.getString('urchin_api_key') ?? this.config.general.urchinApiKey
  }

  public getSeraphApiKey(): string | undefined {
    return this.getString('seraph_api_key') ?? this.config.general.seraphApiKey
  }

  public getOpenrouterApiKey(): string | undefined {
    return this.getString('openrouter_api_key') ?? this.config.general.openrouterApiKey
  }

  public getOpenrouterModel(): string | undefined {
    return this.getString('openrouter_model') ?? this.config.general.openrouterModel
  }

  public setUrchinApiKey(value: string | undefined): void {
    this.set('urchin_api_key', value)
  }

  public setSeraphApiKey(value: string | undefined): void {
    this.set('seraph_api_key', value)
  }

  public setOpenrouterApiKey(value: string | undefined): void {
    this.set('openrouter_api_key', value)
  }

  public setOpenrouterModel(value: string | undefined): void {
    this.set('openrouter_model', value)
  }

  private getString(key: string): string | undefined {
    const value = this.cache.get(key)
    return value === undefined || value.length === 0 ? undefined : value
  }

  private set(key: string, value: string | undefined): void {
    assert.ok(key.length > 0, 'key must not be empty')

    const normalized = value?.trim()
    if (normalized === undefined || normalized.length === 0) {
      this.cache.delete(key)
    } else {
      this.cache.set(key, normalized)
    }

    if (normalized === undefined || normalized.length === 0) {
      void this.databaseManager
        .execute(`DELETE FROM "${AppSettingsManager.TableName}" WHERE "key" = $1`, [key])
        .catch((error: unknown) => {
          this.logger.error('Failed to clear app setting %s:', key, error)
        })
      return
    }

    void this.databaseManager
      .execute(
        `INSERT INTO "${AppSettingsManager.TableName}" ("key", "value", "updated_at") VALUES ($1, $2, NOW())
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW()`,
        [key, normalized]
      )
      .catch((error: unknown) => {
        this.logger.error('Failed to save app setting %s:', key, error)
      })
  }
}
