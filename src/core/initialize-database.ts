import type { DatabaseManager } from '../common/database-manager'

export async function initializeCoreDatabase(databaseManager: DatabaseManager): Promise<void> {
  await databaseManager.awaitReady()

  await databaseManager.runMigrations()

  try {
    await syncSequences(databaseManager)
  } catch {
    // syncSequences may fail on pg-mem (pg_get_serial_sequence is pg-specific)
    // This is non-critical, skip gracefully
  }
}

async function syncSequences(databaseManager: DatabaseManager): Promise<void> {
  const tables = [
    'AllMembers',
    'OnlineMembers',
    'guildMemberStates',
    'guildMemberEvents',
    'guildMemberDailySnapshots',
    'punishments',
    'heatsCommands',
    'proxies',
    'instanceStatusHistory',
    'instanceMessageHistory',
    'rankupPendingReviews',
    'rankupHistory',
    'disconnectLogs',
    'commandErrors',
    'statMonitors',
    'ChatMessages'
  ]

  for (const table of tables) {
    try {
      // This query works for both SERIAL and IDENTITY columns in PostgreSQL.
      // We use coalesce to handle empty tables, resetting the sequence to 1.
      await databaseManager.execute(`
        SELECT setval(
          pg_get_serial_sequence('"${table}"', 'id'),
          COALESCE(MAX(id), 0) + 1,
          false
        ) FROM "${table}"
      `)
    } catch {
      // In-memory databases or non-Postgres environments might not support this.
      // We ignore the error as it's a non-critical optimization/fixup.
    }
  }
}
