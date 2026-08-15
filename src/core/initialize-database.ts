import type { DatabaseManager } from '../common/database-manager'

export async function initializeCoreDatabase(databaseManager: DatabaseManager): Promise<void> {
  await databaseManager.awaitReady()

  await databaseManager.runMigrations()

  try {
    await syncSequences(databaseManager)
  } catch {}
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
      await databaseManager.execute(`
        SELECT setval(
          pg_get_serial_sequence('"${table}"', 'id'),
          COALESCE(MAX(id), 0) + 1,
          false
        ) FROM "${table}"
      `)
    } catch {}
  }
}
