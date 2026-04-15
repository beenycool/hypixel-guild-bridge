import type { DatabaseManager } from '../../common/database-manager'

export class MinecraftAccounts {
  private readonly accounts = new Map<string, GameToggleConfig>()

  constructor(private readonly databaseManager: DatabaseManager) {}

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<StoredGameToggleConfig>('SELECT * FROM "mojangProfileSettings"')

    this.accounts.clear()
    for (const row of rows) {
      this.accounts.set(row.id.toLowerCase(), toGameToggleConfig(row))
    }
  }

  public set(uuid: string, options: GameToggleConfig): void {
    this.accounts.set(uuid.toLowerCase(), options)

    this.databaseManager.enqueueWrite(`saving minecraft account settings ${uuid}`, async (database) => {
      await database.query(
        `INSERT INTO "mojangProfileSettings"
          ("id", "playerOnlineStatusEnabled", "guildAllEnabled", "guildChatEnabled", "guildNotificationsEnabled", "selectedEnglish")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("id") DO UPDATE SET
           "playerOnlineStatusEnabled" = EXCLUDED."playerOnlineStatusEnabled",
           "guildAllEnabled" = EXCLUDED."guildAllEnabled",
           "guildChatEnabled" = EXCLUDED."guildChatEnabled",
           "guildNotificationsEnabled" = EXCLUDED."guildNotificationsEnabled",
           "selectedEnglish" = EXCLUDED."selectedEnglish"`,
        [
          uuid,
          options.playerOnlineStatusEnabled ? 1 : 0,
          options.guildAllEnabled ? 1 : 0,
          options.guildChatEnabled ? 1 : 0,
          options.guildNotificationsEnabled ? 1 : 0,
          options.selectedEnglish ? 1 : 0
        ]
      )
    })
  }

  public get(uuid: string): GameToggleConfig {
    return this.accounts.get(uuid.toLowerCase()) ?? defaultGameToggleConfig()
  }
}

export interface GameToggleConfig {
  playerOnlineStatusEnabled: boolean
  selectedEnglish: boolean

  guildAllEnabled: boolean
  guildChatEnabled: boolean
  guildNotificationsEnabled: boolean
}

interface StoredGameToggleConfig {
  id: string
  playerOnlineStatusEnabled: number
  selectedEnglish: number
  guildAllEnabled: number
  guildChatEnabled: number
  guildNotificationsEnabled: number
}

function defaultGameToggleConfig(): GameToggleConfig {
  return {
    playerOnlineStatusEnabled: false,
    selectedEnglish: false,
    guildAllEnabled: false,
    guildChatEnabled: false,
    guildNotificationsEnabled: false
  }
}

function toGameToggleConfig(row: StoredGameToggleConfig): GameToggleConfig {
  return {
    playerOnlineStatusEnabled: !!row.playerOnlineStatusEnabled,
    selectedEnglish: !!row.selectedEnglish,
    guildAllEnabled: !!row.guildAllEnabled,
    guildChatEnabled: !!row.guildChatEnabled,
    guildNotificationsEnabled: !!row.guildNotificationsEnabled
  }
}
