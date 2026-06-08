import assert from 'node:assert'
import { describe, it } from 'node:test'

import type Application from '../src/application.js'
import { DatabaseManager } from '../src/common/database-manager.js'

interface TestDatabaseManager {
  resolveMaxConnections(): number
}

const Logger = {
  debug: () => {
    /* noop */
  },
  info: () => {
    /* noop */
  },
  warn: () => {
    /* noop */
  },
  error: () => {
    /* noop */
  }
} as unknown as ConstructorParameters<typeof DatabaseManager>[1]

interface FakeApplication {
  addShutdownListener: () => void
  getDatabaseConfig: () => { url?: string; ssl?: boolean; maxConnections?: number }
  getConfigFilePath: (name: string) => string
}

function createFakeApplication(databaseUrl?: string, maxConnections?: number): FakeApplication {
  const config: { url?: string; maxConnections?: number } = {}
  if (databaseUrl !== undefined) config.url = databaseUrl
  if (maxConnections !== undefined) config.maxConnections = maxConnections
  return {
    addShutdownListener: () => {
      /* noop */
    },
    getDatabaseConfig: () => config,
    getConfigFilePath: (name: string) => `/tmp/nonexistent-${name}`
  }
}

await describe('DatabaseManager database selection', async () => {
  await it('supports explicit in-memory databases', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'

    const manager = new DatabaseManager(
      createFakeApplication('memory://database-manager-test') as unknown as Application,
      Logger
    )

    try {
      const rows = await manager.queryRows<{ value: number }>('SELECT 1 AS value')
      assert.strictEqual(rows[0]?.value, 1)
    } finally {
      await manager.close()
      process.env.NODE_ENV = previousNodeEnvironment
    }
  })

  await it('fails fast when no database is configured outside tests', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV
    const previousDatabaseUrl = process.env.DATABASE_URL
    const previousDyno = process.env.DYNO

    process.env.NODE_ENV = 'development'
    delete process.env.DATABASE_URL
    delete process.env.DYNO

    const manager = new DatabaseManager(createFakeApplication() as unknown as Application, Logger)

    try {
      await assert.rejects(async () => {
        await manager.awaitReady()
      }, /No database configured\. Set config\.database\.url or DATABASE_URL/)
    } finally {
      await manager.close()

      process.env.NODE_ENV = previousNodeEnvironment
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      if (previousDyno === undefined) delete process.env.DYNO
      else process.env.DYNO = previousDyno
    }
  })

  await it('resolves max connections correctly from application config', async () => {
    const manager = new DatabaseManager(
      createFakeApplication('memory://database-manager-test', 5) as unknown as Application,
      Logger
    )
    try {
      const max = (manager as unknown as TestDatabaseManager).resolveMaxConnections()
      assert.strictEqual(max, 5)
    } finally {
      await manager.close()
    }
  })

  await it('resolves max connections from environment variable', async () => {
    const previousEnvironment = process.env.DATABASE_MAX_CONNECTIONS
    process.env.DATABASE_MAX_CONNECTIONS = '12'
    const manager = new DatabaseManager(
      createFakeApplication('memory://database-manager-test') as unknown as Application,
      Logger
    )
    try {
      const max = (manager as unknown as TestDatabaseManager).resolveMaxConnections()
      assert.strictEqual(max, 12)
    } finally {
      await manager.close()
      if (previousEnvironment === undefined) delete process.env.DATABASE_MAX_CONNECTIONS
      else process.env.DATABASE_MAX_CONNECTIONS = previousEnvironment
    }
  })

  await it('falls back to default max connections when none specified', async () => {
    const manager = new DatabaseManager(
      createFakeApplication('memory://database-manager-test') as unknown as Application,
      Logger
    )
    try {
      const max = (manager as unknown as TestDatabaseManager).resolveMaxConnections()
      assert.strictEqual(max, 20)
    } finally {
      await manager.close()
    }
  })
})
