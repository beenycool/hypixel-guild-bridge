import type { Player } from 'hypixel-api-reborn'

import type Application from '../application.js'
import { ChannelType, Color, InstanceType } from '../common/application-event.js'
import { Instance } from '../common/instance.js'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'

import {
  extractStatValue,
  formatStatValue,
  getSmartThreshold,
  getStatDecimals,
  getStatLabel
} from './stat-monitor/registry'

interface StatMonitorRow {
  id: number
  ownerId: string
  playerUuid: string
  playerName: string
  game: string
  stat: string
  lastValue: number | null
  threshold: number | null
  bridgeId: string | null
}

export default class StatMonitor extends Instance<InstanceType.Utility> {
  private static readonly DefaultPollIntervalMinutes = 5

  private readonly pollInterval: Duration

  constructor(application: Application) {
    super(application, 'stat-monitor', InstanceType.Utility)

    this.pollInterval = Duration.minutes(StatMonitor.DefaultPollIntervalMinutes)

    setIntervalAsync(
      async () => {
        await this.pollStats().catch(this.errorHandler.promiseCatch('polling stat monitors'))
      },
      {
        delay: this.pollInterval,
        errorHandler: this.errorHandler.promiseCatch('polling stat monitors')
      }
    )
  }

  private async pollStats(): Promise<void> {
    const rows = await this.getAllMonitors()
    if (rows.length === 0) return

    const uniquePlayers = new Map<string, StatMonitorRow[]>()
    for (const row of rows) {
      const existing = uniquePlayers.get(row.playerUuid) ?? []
      existing.push(row)
      uniquePlayers.set(row.playerUuid, existing)
    }

    for (const [playerUuid, watches] of uniquePlayers) {
      const playerName = watches[0].playerName
      const player = await this.fetchPlayer(playerUuid, playerName).catch(() => undefined)
      if (!player) continue

      for (const watch of watches) {
        const currentValue = extractStatValue(player, watch.game, watch.stat)
        if (currentValue === undefined) continue

        const lastValue = watch.lastValue
        if (lastValue === null) {
          await this.updateLastValue(watch.id, currentValue)
        } else {
          const diff = currentValue - lastValue
          const threshold =
            watch.threshold && watch.threshold > 0 ? watch.threshold : getSmartThreshold(watch.stat, lastValue)

          if (Math.abs(diff) >= threshold) {
            const decimals = getStatDecimals(watch.game, watch.stat)
            const statLabel = getStatLabel(watch.game, watch.stat) ?? watch.stat
            const diffString = diff > 0 ? `+${formatStatValue(diff, decimals)}` : formatStatValue(diff, decimals)

            const message =
              `[Monitor] ${playerName}'s ${statLabel}: ${formatStatValue(lastValue, decimals)} ` +
              `→ ${formatStatValue(currentValue, decimals)} (${diffString})`

            await this.application.emit('broadcast', {
              eventId: this.eventHelper.generate(),
              createdAt: Date.now(),
              instanceName: this.instanceName,
              instanceType: this.instanceType,
              bridgeId: watch.bridgeId ?? undefined,
              channels: [ChannelType.Public],
              color: Color.Info,
              user: undefined,
              message: message
            })

            await this.updateLastValue(watch.id, currentValue)
          }
        }
      }
    }
  }

  private async fetchPlayer(uuid: string, name: string): Promise<Player | undefined> {
    try {
      return await this.application.hypixelApi.getPlayer(uuid, {})
    } catch {
      this.logger.warn(`Failed to fetch player stats for ${name} (${uuid})`)
      return undefined
    }
  }

  private async getAllMonitors(): Promise<StatMonitorRow[]> {
    return await this.application.core.databaseManager.queryRows<StatMonitorRow>(
      `SELECT "id", "ownerId", "playerUuid", "playerName", "game", "stat", "lastValue", "threshold", "bridgeId"
       FROM "statMonitors"
       ORDER BY "createdAt" ASC`
    )
  }

  private async updateLastValue(id: number, value: number): Promise<void> {
    await this.application.core.databaseManager.execute(`UPDATE "statMonitors" SET "lastValue" = $1 WHERE "id" = $2`, [
      value,
      id
    ])
  }
}
