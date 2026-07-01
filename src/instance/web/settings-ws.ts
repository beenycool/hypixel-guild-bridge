import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'

export class SettingsWsEvents {
  private readonly subscribers = new Set<WebSocket>()
  private readonly snapshots = new Map<string, string>()
  private timer: NodeJS.Timeout | null = null
  private static readonly DEFAULT_INTERVAL_MS = 3000

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
  }

  public unsubscribe(socket: WebSocket): void {
    this.subscribers.delete(socket)
  }

  public async tick(): Promise<number> {
    if (this.subscribers.size === 0) return 0
    let eventCount = 0
    try {
      const bridgeIds = this.application.core.bridgeConfigurations.getAllBridgeIds()
      const cfg = this.application.core.bridgeConfigurations

      for (const bridgeId of bridgeIds) {
        const raw = JSON.stringify(cfg.getAllSettings(bridgeId))
        const previous = this.snapshots.get(bridgeId)

        if (previous === undefined) {
          this.snapshots.set(bridgeId, raw)
          continue
        }

        if (raw !== previous) {
          this.snapshots.set(bridgeId, raw)
          this.broadcast({
            type: 'settings.configChanged',
            data: { bridgeId, category: 'all', updatedBy: 'external' }
          })
          eventCount++
        }
      }

      for (const bridgeId of this.snapshots.keys()) {
        if (!bridgeIds.includes(bridgeId)) {
          this.snapshots.delete(bridgeId)
        }
      }
    } catch (error: unknown) {
      this.logger.error('SettingsWsEvents tick failed', error)
    }

    return eventCount
  }

  public start(intervalMs: number = SettingsWsEvents.DEFAULT_INTERVAL_MS): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
    }
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => {
        this.logger.error('SettingsWsEvents tick rejected', error)
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
        this.logger.warn('Failed to send settings websocket payload', error)
        this.subscribers.delete(socket)
      }
    }
  }
}
