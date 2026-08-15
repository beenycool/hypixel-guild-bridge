import type { Logger } from 'log4js'

import type { DatabaseManager } from '../../common/database-manager.js'

export interface AuditLogRow {
  id: number
  tournamentId: number
  action: string
  actorDiscordId: string
  targetMatchId: number | undefined
  targetUuid: string | undefined
  metadata: unknown
  createdAt: number
}

export class AuditLogger {
  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly logger?: Logger
  ) {}

  async log(
    tournamentId: number,
    action: string,
    actorDiscordId: string,
    targetMatchId?: number,
    targetUuid?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.logger?.info(
      `AuditLog: Tournament ${tournamentId} — action="${action}", actor=${actorDiscordId}, matchId=${targetMatchId ?? 'none'}, targetUuid=${targetUuid ?? 'none'}`
    )
    try {
      await this.databaseManager.execute(
        `INSERT INTO "tournament_audit_log" ("tournamentId", "action", "actorDiscordId", "targetMatchId", "targetUuid", "metadata")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          tournamentId,
          action,
          actorDiscordId,

          targetMatchId ?? undefined,
          targetUuid ?? undefined,
          metadata ? JSON.stringify(metadata) : undefined
        ]
      )
    } catch (error) {
      this.logger?.error('Audit log error:', error)
    }
  }

  async getLogs(tournamentId: number, limit = 50, offset = 0): Promise<AuditLogRow[]> {
    return await this.databaseManager.queryRows<AuditLogRow>(
      `SELECT * FROM "tournament_audit_log" WHERE "tournamentId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3`,
      [tournamentId, limit, offset]
    )
  }

  async getLogsByAction(action: string, limit = 50): Promise<AuditLogRow[]> {
    return await this.databaseManager.queryRows<AuditLogRow>(
      `SELECT * FROM "tournament_audit_log" WHERE "action" = $1 ORDER BY "createdAt" DESC LIMIT $2`,
      [action, limit]
    )
  }
}
