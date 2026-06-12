import type { Player } from 'hypixel-api-reborn'

import type Application from '../application.js'
import { ChannelType, Color, InstanceType } from '../common/application-event.js'
import { Instance } from '../common/instance.js'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'

import { extractStatValue, formatStatValue, getStatDecimals, getStatLabel } from './stat-monitor/registry'

interface StatMonitorRow {
  id: number
  ownerId: string
  playerUuid: string
  playerName: string
  game: string
  stat: string
  lastValue: number | null
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
        if (lastValue !== null && currentValue !== lastValue) {
          const decimals = getStatDecimals(watch.game, watch.stat)
          const statLabel = getStatLabel(watch.game, watch.stat) ?? watch.stat

          const diff = currentValue - lastValue
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
        }

        await this.updateLastValue(watch.id, currentValue)
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

  public async addMonitor(
    ownerId: string,
    playerUuid: string,
    playerName: string,
    game: string,
    stat: string,
    lastValue: number,
    bridgeId: string | undefined
  ): Promise<void> {
    await this.application.core.databaseManager.execute(
      `INSERT INTO "statMonitors" ("ownerId", "playerUuid", "playerName", "game", "stat", "lastValue", "bridgeId")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("ownerId", "playerUuid", "game", "stat")
       DO UPDATE SET "lastValue" = EXCLUDED."lastValue", "playerName" = EXCLUDED."playerName"`,
      [ownerId, playerUuid, playerName, game, stat, lastValue, bridgeId ?? undefined]
    )
  }

  public async removeMonitor(ownerId: string, playerUuid: string, game: string, stat: string): Promise<boolean> {
    const result = await this.application.core.databaseManager.execute(
      `DELETE FROM "statMonitors" WHERE "ownerId" = $1 AND "playerUuid" = $2 AND "game" = $3 AND "stat" = $4`,
      [ownerId, playerUuid, game, stat]
    )
    return result > 0
  }

  public async removeMonitorById(id: number, ownerId: string): Promise<boolean> {
    const result = await this.application.core.databaseManager.execute(
      `DELETE FROM "statMonitors" WHERE "id" = $1 AND "ownerId" = $2`,
      [id, ownerId]
    )
    return result > 0
  }

  public async getMonitorsForOwner(ownerId: string): Promise<StatMonitorRow[]> {
    return await this.application.core.databaseManager.queryRows<StatMonitorRow>(
      `SELECT "id", "ownerId", "playerUuid", "playerName", "game", "stat", "lastValue", "bridgeId"
       FROM "statMonitors" WHERE "ownerId" = $1
       ORDER BY "createdAt" ASC`,
      [ownerId]
    )
  }

  public async getMonitorCountForOwner(ownerId: string): Promise<number> {
    const row = await this.application.core.databaseManager.queryOne<{ count: string }>(
      `SELECT COUNT(*)::TEXT as "count" FROM "statMonitors" WHERE "ownerId" = $1`,
      [ownerId]
    )
    return Number(row?.count ?? 0)
  }

  private async getAllMonitors(): Promise<StatMonitorRow[]> {
    return await this.application.core.databaseManager.queryRows<StatMonitorRow>(
      `SELECT "id", "ownerId", "playerUuid", "playerName", "game", "stat", "lastValue", "bridgeId"
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
