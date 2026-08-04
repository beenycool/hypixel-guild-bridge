import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'
import type { PendingReview, RankupHistoryEntry } from '../../core/rankup/pending-review-manager.js'

export class RankupWsEvents {
  private readonly subscribers = new Set<WebSocket>()
  private static readonly HistorySnapshotLimit = 50

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {
    void this.application.on('bridgeConfigChanged', (event) => {
      this.broadcast({ type: 'rankup.bridgeConfigChanged', data: { bridgeId: event.bridgeId } })
    })

    void this.application.on('pendingReviewAdded', async (event) => {
      if (this.subscribers.size === 0) return
      const data = { ...event.review } as PendingReview & { name?: string }
      try {
        const profile = await this.application.mojangApi.profileByUuid(data.uuid)
        data.name = profile.name
      } catch {
        // UUID not resolvable
      }
      this.broadcast({ type: 'rankup.reviewAdded', data })
    })

    void this.application.on('pendingReviewRemoved', (event) => {
      this.broadcast({ type: 'rankup.reviewRemoved', data: { bridgeId: event.bridgeId, id: event.id } })
    })

    void this.application.on('pendingHistoryAppended', async (event) => {
      if (this.subscribers.size === 0) return
      const data = { ...event.entry } as RankupHistoryEntry & { name?: string }
      try {
        const profile = await this.application.mojangApi.profileByUuid(data.uuid)
        data.name = profile.name
      } catch {
        // UUID not resolvable
      }
      this.broadcast({ type: 'rankup.historyAppended', data })
    })
  }

  public subscribe(socket: WebSocket): void {
    this.subscribers.add(socket)
    this.sendSnapshot(socket)
  }

  public unsubscribe(socket: WebSocket): void {
    this.subscribers.delete(socket)
  }

  public tick(): number {
    return 0
  }

  public start(): void {
    // No-op: events are push-based via Application events
  }

  public stop(): void {
    this.subscribers.clear()
  }

  private sendSnapshot(socket: WebSocket): void {
    const bridgeIds = this.application.core.bridgeConfigurations.getAllBridgeIds()
    const pendingReviewManager = this.application.core.pendingReviewManager
    const bridges: Record<string, { pending: PendingReview[]; history: RankupHistoryEntry[] }> = {}

    for (const bridgeId of bridgeIds) {
      bridges[bridgeId] = {
        pending: pendingReviewManager.getReviews(bridgeId),
        history: pendingReviewManager.getHistory(bridgeId, RankupWsEvents.HistorySnapshotLimit)
      }
    }

    this.send(socket, { type: 'rankup.snapshot', data: { bridges } })
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

  private send(socket: WebSocket, message: { type: string; data: unknown }): void {
    if (socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(message))
    } catch (error: unknown) {
      this.logger.warn('Failed to send rankup websocket payload', error)
    }
  }
}
