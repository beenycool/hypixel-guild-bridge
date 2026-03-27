import path from 'node:path'

import Database from 'better-sqlite3'
import { Pool } from 'pg'

import { MirroredTables, ensurePostgresMirrorSchema, markPostgresMirrorSeeded } from '../src/common/postgres-mirror.js'

const sqlitePath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(process.cwd(), 'config/users.sqlite')

const databaseUrl = process.env.DATABASE_URL
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL environment variable is required')
}

const sqlite = new Database(sqlitePath, { readonly: true })
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
})

try {
  await ensurePostgresMirrorSchema(pool)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `TRUNCATE TABLE ${MirroredTables.map((table) => quoteIdentifier(table.name)).join(', ')} RESTART IDENTITY CASCADE`
    )

    for (const table of MirroredTables) {
      const rows = sqlite
        .prepare(`SELECT ${quoteColumns(table.columns)} FROM ${quoteIdentifier(table.name)}`)
        .all() as Record<string, unknown>[]

      if (rows.length === 0) {
        console.log(`Skipped ${table.name} (0 rows)`)
        continue
      }

      const insertSql = `INSERT INTO ${quoteIdentifier(table.name)} (${quoteColumns(table.columns)}) VALUES (${table.columns.map((_, index) => `$${index + 1}`).join(', ')})`
      for (const row of rows) {
        await client.query(
          insertSql,
          table.columns.map((column) => row[column] ?? null)
        )
      }

      if (table.columns.includes('id')) {
        const sequenceName = `"${table.name}"`
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${sequenceName}', 'id'), COALESCE(MAX("id"), 0) + 1, false) FROM ${quoteIdentifier(table.name)}`
        )
      }

      console.log(`Migrated ${table.name} (${rows.length} rows)`)
    }

    await client.query('COMMIT')
    await markPostgresMirrorSeeded(pool)
    console.log(`Migration completed from ${sqlitePath}`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
} finally {
  sqlite.close()
  await pool.end()
}

function quoteColumns(columns: readonly string[]): string {
  return columns.map((column) => quoteIdentifier(column)).join(', ')
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
