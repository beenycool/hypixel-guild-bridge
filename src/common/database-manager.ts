import assert from 'node:assert'

import type { Logger } from 'log4js'
import { Pool, type QueryResult, type QueryResultRow } from 'pg'
import { newDb } from 'pg-mem'

import type Application from '../application.js'

type QueryValues = readonly unknown[]

export interface QueryInterface {
  execute(text: string, values?: readonly unknown[]): Promise<number>
}

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: QueryValues): Promise<QueryResult<T>>
}

interface PoolClientLike extends Queryable {
  release(): void
}

interface PoolLike extends Queryable {
  connect(): Promise<PoolClientLike>
  end(): Promise<void>
}

export class DatabaseManager {
  private static readonly CleanEvery = 3 * 60 * 60 * 1000

  private readonly cleanCallbacks: (() => void | Promise<void>)[] = []
  private readonly readyPromise: Promise<void>

  private pool: PoolLike | undefined
  private cleanTimer: NodeJS.Timeout | undefined
  private writeQueue: Promise<void> = Promise.resolve()
  private closed = false
  private healthy = true
  private consecutiveFailures = 0
  private consecutiveSuccesses = 0

  public constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {
    application.addShutdownListener(async () => {
      await this.close()
    })

    this.readyPromise = this.initialize()
  }

  public async awaitReady(): Promise<void> {
    await this.readyPromise
  }

  public registerCleaner(callback: () => void | Promise<void>): void {
    this.cleanCallbacks.push(callback)
  }

  public async queryRows<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: QueryValues = []
  ): Promise<T[]> {
    const result = await this.query(text, values)
    return result.rows as T[]
  }

  public async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: QueryValues = []
  ): Promise<T | undefined> {
    const rows = await this.queryRows<T>(text, values)
    return rows[0]
  }

  public async execute(text: string, values: QueryValues = []): Promise<number> {
    const result = await this.query(text, values)
    return result.rowCount ?? 0
  }

  public enqueueWrite(description: string, callback: (database: Queryable) => Promise<void>): void {
    if (this.closed) return

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await this.awaitReady()
        const pool = this.getPool()

        let timeout: NodeJS.Timeout | undefined
        const timeoutPromise = new Promise((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('Database write operation timed out'))
          }, 30_000)
        })

        try {
          await Promise.race([callback(pool), timeoutPromise])
        } finally {
          clearTimeout(timeout)
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`Database write failed during ${description}`)
        this.logger.error(error)
      })
  }

  public enqueueTransaction(description: string, callback: (database: Queryable) => Promise<void>): void {
    if (this.closed) return

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await this.awaitReady()
        const client = await this.getPool().connect()
        let timeout: NodeJS.Timeout | undefined
        try {
          await client.query('BEGIN')

          const timeoutPromise = new Promise((_, reject) => {
            timeout = setTimeout(() => {
              reject(new Error('Database transaction operation timed out'))
            }, 30_000)
          })
          await Promise.race([callback(client), timeoutPromise])

          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined)
          throw error
        } finally {
          clearTimeout(timeout)
          client.release()
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`Database transaction failed during ${description}`)
        this.logger.error(error)
      })
  }

  public isHealthy(): boolean {
    return this.healthy
  }

  public getPoolStatus(): { connected: boolean; latencyMs: number } {
    return {
      connected: this.pool !== undefined && !this.closed,
      latencyMs: 0
    }
  }

  public async flushWrites(): Promise<void> {
    await this.awaitReady()
    await this.writeQueue
  }

  public async transaction<T>(callback: (database: Queryable) => Promise<T>): Promise<T> {
    await this.awaitReady()
    const client = await this.getPool().connect()

    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async runMigrations(): Promise<void> {
    await this.awaitReady()

    const { runMigrations: run } = await import('../migrations/runner.js')

    await run(async (sql: string, values?: readonly unknown[]) => {
      return await this.query(sql, values)
    })
  }

  public async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    await this.writeQueue

    await this.flushWrites()

    if (this.cleanTimer !== undefined) {
      clearInterval(this.cleanTimer)
      this.cleanTimer = undefined
    }

    const pool = this.pool
    this.pool = undefined
    if (pool !== undefined) {
      await pool.end()
    }
  }

  private async initialize(): Promise<void> {
    const databaseUrl = this.resolveDatabaseUrl()

    if (databaseUrl.startsWith('memory://')) {
      const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true })
      const adapter = memoryDatabase.adapters.createPg()
      const { Pool: RawPool } = adapter as Record<string, unknown>
      const PgPoolAdapter = RawPool as new () => PoolLike
      this.pool = new PgPoolAdapter()
      this.logger.info(`Using in-memory PostgreSQL adapter (${databaseUrl})`)
    } else {
      const ssl = this.resolveSsl(databaseUrl)
      const maxConnections = this.resolveMaxConnections()
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: ssl ? { rejectUnauthorized: false } : undefined,
        max: maxConnections,
        statement_timeout: 30_000,
        lock_timeout: 10_000,
        idle_in_transaction_session_timeout: 30_000
      }) as unknown as PoolLike
      this.logger.info(`Using PostgreSQL database connection with max connections: ${maxConnections}`)
    }

    await this.query('SELECT 1')

    this.cleanTimer = setInterval(() => {
      this.runCleaners().catch((error: unknown) => {
        this.logger.error('Database cleaner failed in interval')
        this.logger.error(error)
      })
    }, DatabaseManager.CleanEvery)
    this.cleanTimer.unref()
  }

  private resolveDatabaseUrl(): string {
    const configured = this.application.getDatabaseConfig()?.url?.trim()
    if (configured) return configured

    const environment = process.env.DATABASE_URL?.trim()
    if (environment) return environment

    if (process.env.NODE_ENV === 'production' || process.env.DYNO !== undefined) {
      throw new Error('DATABASE_URL is required in production environments')
    }

    if (process.env.NODE_ENV === 'test') {
      return 'memory://local'
    }

    throw new Error(
      'No database configured. Set config.database.url or DATABASE_URL. Use memory://local only for explicit test or ephemeral runs.'
    )
  }

  private resolveSsl(databaseUrl: string): boolean {
    const configured = this.application.getDatabaseConfig()?.ssl
    if (configured !== undefined) return configured

    return !/localhost|127\.0\.0\.1/.test(databaseUrl) && databaseUrl.startsWith('postgres')
  }

  private resolveMaxConnections(): number {
    const configured = this.application.getDatabaseConfig()?.maxConnections
    if (configured !== undefined) return configured

    const environment = process.env.DATABASE_MAX_CONNECTIONS
    if (environment !== undefined) {
      const parsed = Number.parseInt(environment, 10)
      if (!Number.isNaN(parsed)) return parsed
    }

    return 3
  }

  private async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: QueryValues = []
  ): Promise<QueryResult<T>> {
    assert.ok(!this.closed, 'Database is closed')
    const pool = this.getPool()
    try {
      const result = await pool.query<T>(text, values)
      this.consecutiveFailures = 0
      this.consecutiveSuccesses++
      if (!this.healthy && this.consecutiveSuccesses >= 3) {
        this.healthy = true
        this.consecutiveSuccesses = 0
        this.logger.info('Database health restored')
      }
      return result
    } catch (error) {
      this.consecutiveSuccesses = 0
      this.consecutiveFailures++
      if (this.healthy && this.consecutiveFailures >= 3) {
        this.healthy = false
        this.consecutiveFailures = 0
        this.logger.error('Database health check failed, marking unhealthy')
      }
      throw error
    }
  }

  private getPool(): PoolLike {
    assert.ok(this.pool !== undefined, 'Database is not initialized yet')
    return this.pool
  }

  private async runCleaners(): Promise<void> {
    for (const cleaner of this.cleanCallbacks) {
      try {
        await cleaner()
      } catch (error) {
        this.logger.error('Database cleaner failed')
        this.logger.error(error)
      }
    }
  }
}
