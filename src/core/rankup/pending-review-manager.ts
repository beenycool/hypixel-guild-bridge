import type { Database } from 'better-sqlite3'

export interface PendingReview {
  id: number
  bridgeId: string
  uuid: string
  currentRank: string
  proposedRank: string
  action: 'promote' | 'demote' | 'kick'
  reason: string
  createdAt: number
  notifiedAt: number | null
}

export interface RankupHistoryEntry {
  id: number
  bridgeId: string
  uuid: string
  action: 'promote' | 'demote' | 'kick' | 'reject' | 'manual_update'
  fromRank: string
  toRank: string
  triggeredBy: string
  createdAt: number
}

export class PendingReviewManager {
  constructor(private readonly database: Database) {}

  public addReview(
    bridgeId: string,
    uuid: string,
    currentRank: string,
    proposedRank: string,
    action: 'promote' | 'demote' | 'kick',
    reason: string
  ): void {
    const stmt = this.database.prepare(`
      INSERT INTO rankupPendingReviews (bridgeId, uuid, currentRank, proposedRank, action, reason)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bridgeId, uuid) DO UPDATE SET
        currentRank = excluded.currentRank,
        proposedRank = excluded.proposedRank,
        action = excluded.action,
        reason = excluded.reason,
        createdAt = unixepoch(),
        notifiedAt = NULL
    `)
    stmt.run(bridgeId, uuid, currentRank, proposedRank, action, reason)
  }

  public getReviews(bridgeId: string): PendingReview[] {
    const stmt = this.database.prepare(`
      SELECT * FROM rankupPendingReviews WHERE bridgeId = ? ORDER BY createdAt ASC
    `)
    return stmt.all(bridgeId) as PendingReview[]
  }

  public getReview(id: number): PendingReview | undefined {
    const stmt = this.database.prepare(`SELECT * FROM rankupPendingReviews WHERE id = ?`)
    return stmt.get(id) as PendingReview | undefined
  }

  public removeReview(id: number): void {
    const stmt = this.database.prepare(`DELETE FROM rankupPendingReviews WHERE id = ?`)
    stmt.run(id)
  }

  public removeReviewByUuid(bridgeId: string, uuid: string): void {
    const stmt = this.database.prepare(`DELETE FROM rankupPendingReviews WHERE bridgeId = ? AND uuid = ?`)
    stmt.run(bridgeId, uuid)
  }

  public clearReviewsNotInList(bridgeId: string, uuids: string[]): void {
    if (uuids.length === 0) {
      const stmt = this.database.prepare(`DELETE FROM rankupPendingReviews WHERE bridgeId = ?`)
      stmt.run(bridgeId)
      return
    }
    const placeholders = uuids.map(() => '?').join(',')
    const stmt = this.database.prepare(
      `DELETE FROM rankupPendingReviews WHERE bridgeId = ? AND uuid NOT IN (${placeholders})`
    )
    stmt.run(bridgeId, ...uuids)
  }

  public updateNotifiedAt(id: number): void {
    const stmt = this.database.prepare(`UPDATE rankupPendingReviews SET notifiedAt = unixepoch() WHERE id = ?`)
    stmt.run(id)
  }

  public logHistory(
    bridgeId: string,
    uuid: string,
    action: RankupHistoryEntry['action'],
    fromRank: string,
    toRank: string,
    triggeredBy: string
  ): void {
    const stmt = this.database.prepare(`
      INSERT INTO rankupHistory (bridgeId, uuid, action, fromRank, toRank, triggeredBy)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    stmt.run(bridgeId, uuid, action, fromRank, toRank, triggeredBy)
  }

  public getHistory(bridgeId: string, limit = 20): RankupHistoryEntry[] {
    const stmt = this.database.prepare(`
      SELECT * FROM rankupHistory WHERE bridgeId = ? ORDER BY createdAt DESC LIMIT ?
    `)
    return stmt.all(bridgeId, limit) as RankupHistoryEntry[]
  }
}
