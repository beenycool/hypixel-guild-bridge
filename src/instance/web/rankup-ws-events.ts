import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'
import type { PendingReview, RankupHistoryEntry } from '../../core/rankup/pending-review-manager.js'

type Subscriber = WebSocket

interface BridgeSnapshot {
  reviewIds: Set<number>
  reviews: Map<number, PendingReview>
  historyIds: Set<number>
  history: Map<number, RankupHistoryEntry>
}

export class RankupWsEvents {
  private readonly subscribers = new Set<Subscriber>()
  private readonly snapshots = new Map<string, BridgeSnapshot>()
  private timer: NodeJS.Timeout | null = null
  private static readonly DEFAULT_INTERVAL_MS = 1000
  private static readonly HISTORY_SNAPSHOT_LIMIT = 50

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {
    void this.application.on('bridgeConfigChanged', (event) => {
      this.broadcast({ type: 'rankup.bridgeConfigChanged', data: { bridgeId: event.bridgeId } })
    })
  }

  public subscribe(socket: WebSocket): void {
    this.subscribers.add(socket)
  }

  public unsubscribe(socket: WebSocket): void {
    this.subscribers.delete(socket)
  }

  public async tick(): Promise<number> {
    if (this.subscribers.size === 0) return 0
    let eventCount = 0
    try {
      const bridgeIds = this.application.core.bridgeConfigurations.getAllBridgeIds()
      const pendingReviewManager = this.application.core.pendingReviewManager

      for (const bridgeId of bridgeIds) {
        const reviews = pendingReviewManager.getReviews(bridgeId)
        const history = pendingReviewManager.getHistory(bridgeId, RankupWsEvents.HISTORY_SNAPSHOT_LIMIT)

        const newReviewIds = new Set<number>()
        const newReviews = new Map<number, PendingReview>()
        for (const review of reviews) {
          newReviewIds.add(review.id)
          newReviews.set(review.id, review)
        }

        const newHistoryIds = new Set<number>()
        const newHistory = new Map<number, RankupHistoryEntry>()
        for (const entry of history) {
          newHistoryIds.add(entry.id)
          newHistory.set(entry.id, entry)
        }

        const previous = this.snapshots.get(bridgeId)
        if (previous === undefined) {
          this.snapshots.set(bridgeId, {
            reviewIds: newReviewIds,
            reviews: newReviews,
            historyIds: newHistoryIds,
            history: newHistory
          })
          continue
        }

        for (const review of newReviews.values()) {
          if (!previous.reviewIds.has(review.id)) {
            this.broadcast({ type: 'rankup.reviewAdded', data: review })
            eventCount++
          }
        }

        for (const id of previous.reviewIds) {
          if (!newReviewIds.has(id)) {
            this.broadcast({ type: 'rankup.reviewRemoved', data: { id, bridgeId } })
            eventCount++
          }
        }

        for (const entry of newHistory.values()) {
          if (!previous.historyIds.has(entry.id)) {
            this.broadcast({ type: 'rankup.historyAppended', data: entry })
            eventCount++
          }
        }

        this.snapshots.set(bridgeId, {
          reviewIds: newReviewIds,
          reviews: newReviews,
          historyIds: newHistoryIds,
          history: newHistory
        })
      }

      for (const bridgeId of this.snapshots.keys()) {
        if (!bridgeIds.includes(bridgeId)) {
          this.snapshots.delete(bridgeId)
        }
      }
    } catch (error: unknown) {
      this.logger.error('RankupWsEvents tick failed', error)
    }

    return eventCount
  }

  public start(intervalMs: number = RankupWsEvents.DEFAULT_INTERVAL_MS): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
    }
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => {
        this.logger.error('RankupWsEvents tick rejected', error)
      })
    }, intervalMs)
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.subscribers.clear()
  }

  private broadcast(message: { type: string; data: unknown }): void {
    if (this.subscribers.size === 0) return
    const payload = JSON.stringify(message)
    for (const socket of this.subscribers) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.subscribers.delete(socket)
        continue
      }
      try {
        socket.send(payload)
      } catch (error: unknown) {
        this.logger.warn('Failed to send rankup websocket payload', error)
        this.subscribers.delete(socket)
      }
    }
  }
}
