import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'

export class TournamentWsEvents {
  private readonly subscribers = new Set<WebSocket>()

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  public subscribe(socket: WebSocket): void {
    this.subscribers.add(socket)
  }

  public unsubscribe(socket: WebSocket): void {
    this.subscribers.delete(socket)
  }

  public start(): void {
    // No-op: events can be pushed externally via broadcast
  }

  public stop(): void {
    this.subscribers.clear()
  }

  public broadcast(data: { type: string; data: unknown }): void {
    if (this.subscribers.size === 0) return
    const payload = JSON.stringify(data)
    for (const socket of this.subscribers) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.subscribers.delete(socket)
        continue
      }
      try {
        socket.send(payload)
      } catch (error: unknown) {
        this.logger.warn('Failed to send tournament websocket payload', error)
        this.subscribers.delete(socket)
      }
    }
  }
}
