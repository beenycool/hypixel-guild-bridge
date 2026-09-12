import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'
import type { PendingReview, RankupHistoryEntry } from '../../core/rankup/pending-review-manager.js'

interface RankupSubscriber {
  bridgeId?: string
}

export class RankupWsEvents {
  private readonly subscribers = new Map<WebSocket, RankupSubscriber>()
  private static readonly HistorySnapshotLimit = 50

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {
    void this.application.on('bridgeConfigChanged', (event) => {
      this.broadcastScoped(event.bridgeId, { type: 'rankup.bridgeConfigChanged', data: { bridgeId: event.bridgeId } })
    })

    void this.application.on('pendingReviewAdded', async (event) => {
      if (this.subscribers.size === 0) return
      const data = { ...event.review } as PendingReview & { name?: string }
      try {
        const profile = await this.application.mojangApi.profileByUuid(data.uuid)
        data.name = profile.name
      } catch {
        // Mojang profile lookup failed
      }
      this.broadcastScoped(event.bridgeId, { type: 'rankup.reviewAdded', data })
    })

    void this.application.on('pendingReviewRemoved', (event) => {
      this.broadcastScoped(event.bridgeId, {
        type: 'rankup.reviewRemoved',
        data: { bridgeId: event.bridgeId, id: event.id }
      })
    })

    void this.application.on('pendingHistoryAppended', async (event) => {
      if (this.subscribers.size === 0) return
      const data = { ...event.entry } as RankupHistoryEntry & { name?: string }
      try {
        const profile = await this.application.mojangApi.profileByUuid(data.uuid)
        data.name = profile.name
      } catch {
        // Mojang profile lookup failed
      }
      this.broadcastScoped(event.bridgeId, { type: 'rankup.historyAppended', data })
    })
  }

  public subscribe(socket: WebSocket, bridgeId?: string): void {
    this.subscribers.set(socket, { bridgeId })
    this.sendSnapshot(socket)
  }

  public unsubscribe(socket: WebSocket): void {
    this.subscribers.delete(socket)
  }

  public start(): void {
    this.subscribers.clear()
  }

  public stop(): void {
    this.subscribers.clear()
  }

  private sendSnapshot(socket: WebSocket): void {
    const info = this.subscribers.get(socket)
    if (info === undefined) return

    const pendingReviewManager = this.application.core.pendingReviewManager
    const bridges: Record<string, { pending: PendingReview[]; history: RankupHistoryEntry[] }> = {}

    if (info.bridgeId !== undefined) {
      bridges[info.bridgeId] = {
        pending: pendingReviewManager.getReviews(info.bridgeId),
        history: pendingReviewManager.getHistory(info.bridgeId, RankupWsEvents.HistorySnapshotLimit)
      }
    }

    this.send(socket, { type: 'rankup.snapshot', data: { bridges } })
  }

  private broadcastScoped(bridgeId: string, message: { type: string; data: unknown }): void {
    if (this.subscribers.size === 0) return
    const payload = JSON.stringify(message)

    for (const [socket, info] of this.subscribers) {
      if (info.bridgeId !== bridgeId) continue

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
