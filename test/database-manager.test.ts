import assert from 'node:assert'
import { describe, it } from 'node:test'

import { DatabaseManager } from '../src/common/database-manager.js'

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
} as unknown as ConstructorParameters<typeof DatabaseManager>[1]

function createFakeApplication(databaseUrl?: string) {
  return {
    addShutdownListener: () => {},
    getDatabaseConfig: () => (databaseUrl === undefined ? {} : { url: databaseUrl }),
    getConfigFilePath: (name: string) => `/tmp/nonexistent-${name}`
  }
}

await describe('DatabaseManager database selection', async () => {
  await it('supports explicit in-memory databases', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'

    const manager = new DatabaseManager(createFakeApplication('memory://database-manager-test') as any, logger)

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

    const manager = new DatabaseManager(createFakeApplication() as any, logger)

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
})
