import type { DatabaseManager } from '../../common/database-manager'

export interface PendingReview {
  id: number
  bridgeId: string
  uuid: string
  currentRank: string
  proposedRank: string
  action: 'promote' | 'demote' | 'kick'
  reason: string
  createdAt: number
  notifiedAt: number | undefined
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
  private readonly reviews = new Map<number, PendingReview>()
  private readonly history: RankupHistoryEntry[] = []
  private nextReviewId = 1
  private nextHistoryId = 1

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly onEvent?: (type: string, data: any) => void
  ) {
    this.databaseManager.registerCleaner(() => {
      this.pruneHistory()
    })
  }

  public async load(): Promise<void> {
    const reviews = await this.databaseManager.queryRows<PendingReview>(
      'SELECT * FROM "rankupPendingReviews" ORDER BY "id" ASC'
    )
    const history = await this.databaseManager.queryRows<RankupHistoryEntry>(
      'SELECT * FROM "rankupHistory" ORDER BY "id" ASC'
    )

    this.reviews.clear()
    this.nextReviewId = 0
    for (const review of reviews) {
      this.reviews.set(review.id, review)
      if (review.id >= this.nextReviewId) this.nextReviewId = review.id + 1
    }

    this.history.length = 0
    this.history.push(...history)
    this.nextHistoryId = 0
    for (const entry of history) {
      if (entry.id >= this.nextHistoryId) this.nextHistoryId = entry.id + 1
    }
  }

  public addReview(
    bridgeId: string,
    uuid: string,
    currentRank: string,
    proposedRank: string,
    action: 'promote' | 'demote' | 'kick',
    reason: string
  ): void {
    const existing = [...this.reviews.values()].find((review) => review.bridgeId === bridgeId && review.uuid === uuid)
    const review: PendingReview = {
      id: existing?.id ?? this.nextReviewId++,
      bridgeId,
      uuid,
      currentRank,
      proposedRank,
      action,
      reason,
      createdAt: Math.floor(Date.now() / 1000),
      notifiedAt: undefined
    }
    this.reviews.set(review.id, review)
    this.onEvent?.('reviewAdded', { bridgeId, review })

    this.databaseManager.enqueueWrite(`saving rankup review ${bridgeId}:${uuid}`, async (database) => {
      await database.query(
        `INSERT INTO "rankupPendingReviews"
          ("id", "bridgeId", "uuid", "currentRank", "proposedRank", "action", "reason", "createdAt", "notifiedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT ("bridgeId", "uuid") DO UPDATE SET
           "currentRank" = EXCLUDED."currentRank",
           "proposedRank" = EXCLUDED."proposedRank",
           "action" = EXCLUDED."action",
           "reason" = EXCLUDED."reason",
           "createdAt" = EXCLUDED."createdAt",
           "notifiedAt" = EXCLUDED."notifiedAt"`,
        [
          review.id,
          review.bridgeId,
          review.uuid,
          review.currentRank,
          review.proposedRank,
          review.action,
          review.reason,
          review.createdAt,
          review.notifiedAt
        ]
      )
    })
  }

  public getReviews(bridgeId: string): PendingReview[] {
    return [...this.reviews.values()]
      .filter((review) => review.bridgeId === bridgeId)
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .map((review) => ({ ...review }))
  }

  public getReview(id: number): PendingReview | undefined {
    const review = this.reviews.get(id)
    return review === undefined ? undefined : { ...review }
  }

  public removeReview(id: number): void {
    const review = this.reviews.get(id)
    this.reviews.delete(id)
    if (review !== undefined) {
      this.onEvent?.('reviewRemoved', { bridgeId: review.bridgeId, id: review.id })
    }
    this.databaseManager.enqueueWrite(`removing rankup review ${id}`, async (database) => {
      await database.query('DELETE FROM "rankupPendingReviews" WHERE "id" = $1', [id])
    })
  }

  public removeReviewByUuid(bridgeId: string, uuid: string): void {
    const toDelete: number[] = []
    for (const review of this.reviews.values()) {
      if (review.bridgeId === bridgeId && review.uuid === uuid) {
        toDelete.push(review.id)
      }
    }
    for (const id of toDelete) {
      this.reviews.delete(id)
      this.onEvent?.('reviewRemoved', { bridgeId, id })
    }

    this.databaseManager.enqueueWrite(`removing rankup review ${bridgeId}:${uuid}`, async (database) => {
      await database.query('DELETE FROM "rankupPendingReviews" WHERE "bridgeId" = $1 AND "uuid" = $2', [bridgeId, uuid])
    })
  }

  public clearReviewsNotInList(bridgeId: string, uuids: string[]): void {
    const keep = new Set(uuids)
    for (const review of this.reviews.values()) {
      if (review.bridgeId === bridgeId && !keep.has(review.uuid)) {
        this.reviews.delete(review.id)
        this.onEvent?.('reviewRemoved', { bridgeId, id: review.id })
      }
    }

    this.databaseManager.enqueueWrite(`clearing stale rankup reviews for ${bridgeId}`, async (database) => {
      if (uuids.length === 0) {
        await database.query('DELETE FROM "rankupPendingReviews" WHERE "bridgeId" = $1', [bridgeId])
        return
      }

      await database.query(
        'DELETE FROM "rankupPendingReviews" WHERE "bridgeId" = $1 AND NOT ("uuid" = ANY($2::text[]))',
        [bridgeId, uuids]
      )
    })
  }

  public updateNotifiedAt(id: number): void {
    const review = this.reviews.get(id)
    if (review === undefined) return

    review.notifiedAt = Math.floor(Date.now() / 1000)
    this.databaseManager.enqueueWrite(`updating rankup notifiedAt ${id}`, async (database) => {
      await database.query('UPDATE "rankupPendingReviews" SET "notifiedAt" = $1 WHERE "id" = $2', [
        review.notifiedAt,
        id
      ])
    })
  }

  public logHistory(
    bridgeId: string,
    uuid: string,
    action: RankupHistoryEntry['action'],
    fromRank: string,
    toRank: string,
    triggeredBy: string
  ): void {
    const entry: RankupHistoryEntry = {
      id: this.nextHistoryId++,
      bridgeId,
      uuid,
      action,
      fromRank,
      toRank,
      triggeredBy,
      createdAt: Math.floor(Date.now() / 1000)
    }
    this.history.push(entry)
    this.onEvent?.('historyAppended', { bridgeId, entry })

    this.databaseManager.enqueueWrite(`saving rankup history ${bridgeId}:${uuid}`, async (database) => {
      await database.query(
        `INSERT INTO "rankupHistory" ("id", "bridgeId", "uuid", "action", "fromRank", "toRank", "triggeredBy", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          entry.id,
          entry.bridgeId,
          entry.uuid,
          entry.action,
          entry.fromRank,
          entry.toRank,
          entry.triggeredBy,
          entry.createdAt
        ]
      )
    })
  }

  public pruneHistory(): void {
    const maxEntries = 1000
    if (this.history.length > maxEntries) {
      this.history.splice(0, this.history.length - maxEntries)
    }
  }

  public getHistory(bridgeId: string, limit = 20): RankupHistoryEntry[] {
    return this.history
      .filter((entry) => entry.bridgeId === bridgeId)
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((entry) => ({ ...entry }))
  }
}
