import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'
import type { TournamentManager } from '../../core/tournament/tournament-manager.js'

interface TournamentSubscriber {
  bridgeId?: string
}

export class TournamentWsEvents {
  private readonly subscribers = new Map<WebSocket, TournamentSubscriber>()

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {
    const tournamentManager = (this.application.core as { tournamentManager?: TournamentManager }).tournamentManager
    tournamentManager?.onEvent((event) => {
      this.handleEvent(event).catch((error: unknown) => {
        this.logger.warn('Failed to broadcast tournament websocket event', error)
      })
    })
  }

  public subscribe(socket: WebSocket, bridgeId?: string): void {
    this.logger.info(`TournamentWsEvents: Subscriber added (total: ${this.subscribers.size + 1})`)
    this.subscribers.set(socket, { bridgeId })
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

  private async handleEvent(event: { type: string; data: unknown }): Promise<void> {
    const bridgeId = await this.resolveEventBridgeId(event.data)
    if (bridgeId === undefined) return

    this.broadcastScoped(bridgeId, event.type, event.data)
  }

  private async resolveEventBridgeId(data: unknown): Promise<string | undefined> {
    if (data === null || typeof data !== 'object') return undefined
    const record = data as { tournament?: unknown; tournamentId?: unknown }

    const tournament = record.tournament
    if (tournament !== null && typeof tournament === 'object') {
      const bridgeId = (tournament as { bridgeId?: unknown }).bridgeId
      if (typeof bridgeId === 'string' && bridgeId.length > 0) return bridgeId
    }

    if (typeof record.tournamentId === 'number') {
      const stored = await this.application.core.tournamentManager
        .getTournament(record.tournamentId)
        .catch(() => undefined)
      return stored?.bridgeId
    }

    return undefined
  }

  private broadcastScoped(bridgeId: string, type: string, data: unknown): void {
    if (this.subscribers.size === 0) return
    this.logger.info(`TournamentWsEvents: Broadcasting ${type} to bridge "${bridgeId}"`)
    const payload = JSON.stringify({ type, data })

    for (const [socket, info] of this.subscribers) {
      if (info.bridgeId !== bridgeId) continue

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
