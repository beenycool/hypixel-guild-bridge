import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'
import type { TournamentManager } from '../../core/tournament/tournament-manager.js'

export class TournamentWsEvents {
  private readonly subscribers = new Set<WebSocket>()

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {
    // Core pushes lifecycle events; forward them to WS subscribers.
    // Shallow-mocked applications (tests) may omit core.tournamentManager.
    const tournamentManager = (this.application.core as { tournamentManager?: TournamentManager }).tournamentManager
    tournamentManager?.onEvent((event) => {
      this.broadcast(event)
    })
  }

  public subscribe(socket: WebSocket): void {
    this.logger.info(`TournamentWsEvents: Subscriber added (total: ${this.subscribers.size + 1})`)
    this.subscribers.add(socket)
  }

  public unsubscribe(socket: WebSocket): void {
    this.logger.info(`TournamentWsEvents: Subscriber removed (total: ${this.subscribers.size - 1})`)
    this.subscribers.delete(socket)
  }

  public start(): void {
    this.logger.info('TournamentWsEvents: Started')
  }

  public stop(): void {
    this.logger.info(`TournamentWsEvents: Stopped, clearing ${this.subscribers.size} subscriber(s)`)
    this.subscribers.clear()
  }

  public broadcast(data: { type: string; data: unknown }): void {
    if (this.subscribers.size === 0) return
    this.logger.info(`TournamentWsEvents: Broadcasting ${data.type} to ${this.subscribers.size} subscriber(s)`)
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
