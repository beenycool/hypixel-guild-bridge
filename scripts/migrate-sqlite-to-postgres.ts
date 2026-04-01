import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import Logger4js from 'log4js'

import { SqliteManager } from '../src/common/sqlite-manager.js'
import { initializeCoreDatabase } from '../src/core/initialize-database.js'

interface MinimalApplication {
  addShutdownListener(listener: () => void | Promise<void>): void
  getDatabaseConfig(): { url: string; ssl?: boolean }
  getConfigFilePath(name: string): string
}

const sourceSqlitePath = path.resolve(process.argv[2] ?? process.env.SQLITE_PATH ?? 'config/users.sqlite')
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

if (!fs.existsSync(sourceSqlitePath)) {
  throw new Error(`SQLite source file not found: ${sourceSqlitePath}`)
}

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hypixel-sqlite-migration-'))
const stagedSqlitePath = path.join(tempDirectory, 'users.sqlite')

copySqliteBundle(sourceSqlitePath, stagedSqlitePath)

const logger = Logger4js.getLogger('sqlite-migration')
logger.level = 'info'

const shutdownListeners: Array<() => void | Promise<void>> = []
const application: MinimalApplication = {
  addShutdownListener(listener) {
    shutdownListeners.push(listener)
  },
  getDatabaseConfig() {
    return { url: databaseUrl }
  },
  getConfigFilePath(name) {
    return name === 'users.sqlite' ? stagedSqlitePath : path.join(tempDirectory, name)
  }
}

const sqliteManager = new SqliteManager(application as never, logger)

try {
  console.log(`Using SQLite source: ${sourceSqlitePath}`)
  console.log(`Staged SQLite bundle in: ${tempDirectory}`)

  await initializeCoreDatabase(application as never, sqliteManager, 'users.sqlite')
  await sqliteManager.flushWrites()

  console.log('SQLite to PostgreSQL migration finished successfully.')
} finally {
  await sqliteManager.close().catch(() => undefined)
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}

function copySqliteBundle(sourcePath: string, destinationPath: string): void {
  fs.copyFileSync(sourcePath, destinationPath)
  copyOptionalSidecar(`${sourcePath}-wal`, `${destinationPath}-wal`)
  copyOptionalSidecar(`${sourcePath}-shm`, `${destinationPath}-shm`)
}

function copyOptionalSidecar(sourcePath: string, destinationPath: string): void {
  if (!fs.existsSync(sourcePath)) return
  fs.copyFileSync(sourcePath, destinationPath)
}
