import type { QueryInterface } from '../runner.js'

const RemovedTables = [
  'DiscordMessages',
  'MinecraftMessages',
  'DiscordCommands',
  'MinecraftCommands',
  'AllMembers',
  'OnlineMembers',
  'guildMemberEvents',
  'guildMemberDailySnapshots',
  'punishments',
  'heatsCommands',
  'heatsCommandsWarnings',
  'commandErrors',
  'proxies',
  'minecraftBots',
  'inactivity',
  'disconnectLogs',
  'discordLeaderboards'
]

export async function up(query: QueryInterface): Promise<void> {
  for (const table of RemovedTables) {
    await query.execute(`DROP TABLE IF EXISTS "${table}" CASCADE`)
  }
  await query.execute(`ALTER TABLE "mojangInstances" DROP COLUMN IF EXISTS "proxyId"`)
}

export async function down(query: QueryInterface): Promise<void> {
  void query
  throw new Error('Migration 017-drop-removed-features is irreversible: up() drops 17 tables and cannot restore deleted data.')
}
