import type { Logger } from 'log4js'
import { WebSocket } from 'ws'

import type Application from '../../application.js'
import { Permission } from '../../common/application-event.js'

interface SettingsSubscriber {
  bridgeId?: string
  permission: Permission
}

export class SettingsWsEvents {
  private readonly subscribers = new Map<WebSocket, SettingsSubscriber>()

  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {
    void this.application.on('bridgeConfigChanged', (event) => {
      this.broadcastScoped(event.bridgeId, {
        type: 'settings.configChanged',
        data: { bridgeId: event.bridgeId, category: 'rankup', updatedBy: 'discord' }
      })
    })
  }

  public subscribe(socket: WebSocket, bridgeId?: string, permission = Permission.Anyone): void {
    this.subscribers.set(socket, { bridgeId, permission })
    this.sendSnapshot(socket)
  }

  public unsubscribe(socket: WebSocket): void {
    this.subscribers.delete(socket)
  }

  public stop(): void {
    this.subscribers.clear()
  }

  private sendSnapshot(socket: WebSocket): void {
    const info = this.subscribers.get(socket)
    if (info === undefined) return

    const cfg = this.application.core.bridgeConfigurations
    const data: Record<string, Record<string, unknown>> = {}

    if (info.bridgeId !== undefined) {
      data[info.bridgeId] = cfg.getAllSettings(info.bridgeId)
    } else if (info.permission >= Permission.Admin) {
      for (const bridgeId of cfg.getAllBridgeIds()) {
        data[bridgeId] = cfg.getAllSettings(bridgeId)
      }
    }

    this.send(socket, { type: 'settings.snapshot', data })
  }

  private broadcastScoped(bridgeId: string, message: { type: string; data: unknown }): void {
    if (this.subscribers.size === 0) return
    const payload = JSON.stringify(message)

    for (const [socket, info] of this.subscribers) {
      if (info.bridgeId === undefined) {
        if (info.permission < Permission.Admin) continue
      } else if (info.bridgeId !== bridgeId) {
        continue
      }

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
