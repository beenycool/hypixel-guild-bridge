import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Umzug, type UmzugStorage } from 'umzug'

export type QueryFunction = (
  sql: string,
  values?: readonly unknown[]
) => Promise<{ rows: unknown[]; rowCount: number | null }>

export interface QueryInterface {
  execute(text: string, values?: readonly unknown[]): Promise<number>
}

export async function runMigrations(query: QueryFunction): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS "_migrations" (
      "name" TEXT PRIMARY KEY,
      "executedAt" INTEGER NOT NULL DEFAULT CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER)
    )`
  )

  const dirname = path.dirname(fileURLToPath(import.meta.url))

  const queryInterface: QueryInterface = {
    execute: async (text, values) => {
      const result = await query(text, values)
      return result.rowCount ?? 0
    }
  }

  const storage: UmzugStorage<QueryInterface> = {
    async logMigration({ name }) {
      await query(
        `INSERT INTO "_migrations" ("name", "executedAt") VALUES ($1, CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER))`,
        [name]
      )
    },
    async unlogMigration({ name }) {
      await query(`DELETE FROM "_migrations" WHERE "name" = $1`, [name])
    },
    async executed() {
      const result = await query(`SELECT "name" FROM "_migrations" ORDER BY "name"`)
      return (result.rows as { name: string }[]).map((row) => row.name)
    }
  }

  const umzug = new Umzug({
    migrations: {
      glob: ['*.{js,ts,mjs}', { cwd: dirname, ignore: ['runner.*'] }],
      resolve: ({ name, path: filepath }) => {
        if (!filepath) throw new Error('Migration file path is required')

        return {
          name,
          path: filepath,
          up: async () => {
            const { up } = (await import(pathToFileURL(filepath).href)) as {
              up: (context: QueryInterface) => Promise<void>
            }
            await up(queryInterface)
          },
          down: async () => {
            const { down } = (await import(pathToFileURL(filepath).href)) as {
              down?: (context: QueryInterface) => Promise<void>
            }
            await down?.(queryInterface)
          }
        }
      }
    },
    context: queryInterface,
    storage,
    logger: undefined
  })

  await umzug.up()
}
