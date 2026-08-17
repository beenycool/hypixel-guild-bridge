import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'

export class SettingsWsEvents {
  private readonly subscribers = new Set<WebSocket>()

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {
    void this.application.on('bridgeConfigChanged', (event) => {
      this.broadcast({
        type: 'settings.configChanged',
        data: { bridgeId: event.bridgeId, category: 'rankup', updatedBy: 'discord' }
      })
    })
  }

  public subscribe(socket: WebSocket): void {
    this.subscribers.add(socket)
    this.sendSnapshot(socket)
  }

  public unsubscribe(socket: WebSocket): void {
    this.subscribers.delete(socket)
  }

  public start(): void {
    // Event-driven: no background timer required
  }

  public stop(): void {
    this.subscribers.clear()
  }

  private sendSnapshot(socket: WebSocket): void {
    const bridgeIds = this.application.core.bridgeConfigurations.getAllBridgeIds()
    const cfg = this.application.core.bridgeConfigurations
    const data: Record<string, Record<string, unknown>> = {}

    for (const bridgeId of bridgeIds) {
      data[bridgeId] = cfg.getAllSettings(bridgeId)
    }

    this.send(socket, { type: 'settings.snapshot', data })
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
        this.logger.warn('Failed to send settings websocket payload', error)
        this.subscribers.delete(socket)
      }
    }
  }

  private send(socket: WebSocket, message: { type: string; data: unknown }): void {
    if (socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(message))
    } catch (error: unknown) {
      this.logger.warn('Failed to send settings websocket payload', error)
    }
  }
}
