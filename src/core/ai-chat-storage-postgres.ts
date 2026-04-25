import type { AiChatStorage } from '../common/ai-chat-storage'
import type { DatabaseManager } from '../common/database-manager'

import type { BridgeConfigurations } from './discord/bridge-configurations'

const DefaultBridgeKey = 'default'
const AiChatNoteTtlSeconds = 30 * 24 * 60 * 60

function resolveBridgeKey(bridgeId: string | undefined): string {
  return bridgeId ?? DefaultBridgeKey
}

interface MuteRow {
  muted: boolean
}

interface NoteRow {
  note: string
}

export class PostgresAiChatStorage implements AiChatStorage {
  private readonly mutedCache = new Map<string, boolean>()
  private loaded = false

  public constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly bridgeConfigurations: BridgeConfigurations
  ) {
    this.databaseManager.registerCleaner(async () => {
      await this.deleteExpiredNotes()
    })
  }

  public async load(): Promise<void> {
    const rows = await this.databaseManager.queryRows<{ bridgeId: string; muted: boolean }>(
      'SELECT "bridge_id" AS "bridgeId", "muted" FROM "ai_chat_mute"'
    )

    this.mutedCache.clear()
    for (const row of rows) {
      this.mutedCache.set(row.bridgeId, row.muted)
    }
    this.loaded = true
  }

  public isBridgeEnabled(bridgeId: string | undefined): Promise<boolean> {
    return Promise.resolve(this.bridgeConfigurations.getAiChatEnabled(resolveBridgeKey(bridgeId)))
  }

  public async isBridgeMuted(bridgeId: string | undefined): Promise<boolean> {
    const key = resolveBridgeKey(bridgeId)
    if (this.loaded) return this.mutedCache.get(key) ?? false

    const row = await this.databaseManager.queryOne<MuteRow>(
      'SELECT "muted" FROM "ai_chat_mute" WHERE "bridge_id" = $1',
      [key]
    )
    return row?.muted ?? false
  }

  public setBridgeMuted(bridgeId: string | undefined, muted: boolean): Promise<void> {
    const key = resolveBridgeKey(bridgeId)
    this.mutedCache.set(key, muted)

    this.databaseManager.enqueueWrite(`ai chat mute ${key}`, async (database) => {
      await database.query(
        `INSERT INTO "ai_chat_mute" ("bridge_id", "muted", "updated_at")
         VALUES ($1, $2, CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER))
         ON CONFLICT ("bridge_id") DO UPDATE
           SET "muted" = EXCLUDED."muted",
               "updated_at" = EXCLUDED."updated_at"`,
        [key, muted]
      )
    })
    return Promise.resolve()
  }

  public async getNote(bridgeId: string | undefined, playerId: string): Promise<string | undefined> {
    const key = resolveBridgeKey(bridgeId)
    const now = nowUnixSeconds()
    const row = await this.databaseManager.queryOne<NoteRow>(
      'SELECT "note" FROM "ai_chat_notes" WHERE "bridge_id" = $1 AND "player_id" = $2 AND "expires_at" > $3',
      [key, playerId, now]
    )
    return row?.note
  }

  public async renderNotesMarkdown(bridgeId: string | undefined, playerId: string): Promise<string> {
    const note = await this.getNote(bridgeId, playerId)
    if (note === undefined || note.length === 0) return ''
    return `Known about this user: ${note}`
  }

  public saveNote(bridgeId: string | undefined, playerId: string, note: string): Promise<void> {
    const key = resolveBridgeKey(bridgeId)
    const trimmed = note.trim()
    if (trimmed.length === 0) return Promise.resolve()

    const now = nowUnixSeconds()
    const expiresAt = now + AiChatNoteTtlSeconds

    this.databaseManager.enqueueWrite(`ai chat note ${key}/${playerId}`, async (database) => {
      await database.query(
        `INSERT INTO "ai_chat_notes" ("bridge_id", "player_id", "note", "expires_at", "updated_at")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("bridge_id", "player_id") DO UPDATE
            SET "note" = EXCLUDED."note",
                "expires_at" = EXCLUDED."expires_at",
                "updated_at" = EXCLUDED."updated_at"`,
        [key, playerId, trimmed, expiresAt, now]
      )
    })
    return Promise.resolve()
  }

  public async getUserMode(playerId: string): Promise<string | undefined> {
    const row = await this.databaseManager.queryOne<{ mode: string }>(
      'SELECT "mode" FROM "ai_chat_user_config" WHERE "player_id" = $1',
      [playerId]
    )
    return row?.mode
  }

  public setUserMode(playerId: string, mode: string | undefined): Promise<void> {
    this.databaseManager.enqueueWrite(`ai chat user config ${playerId}`, async (database) => {
      if (mode === undefined) {
        await database.query('UPDATE "ai_chat_user_config" SET "mode" = NULL WHERE "player_id" = $1', [playerId])
      } else {
        await database.query(
          `INSERT INTO "ai_chat_user_config" ("player_id", "mode", "updated_at")
           VALUES ($1, $2, CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER))
           ON CONFLICT ("player_id") DO UPDATE
             SET "mode" = EXCLUDED."mode",
                 "updated_at" = EXCLUDED."updated_at"`,
          [playerId, mode]
        )
      }
    })
    return Promise.resolve()
  }

  private async deleteExpiredNotes(): Promise<void> {
    const now = nowUnixSeconds()
    await this.databaseManager.execute('DELETE FROM "ai_chat_notes" WHERE "expires_at" <= $1', [now])
  }
}

function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
