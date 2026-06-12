import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import {
  extractStatValue,
  formatStatValue,
  getStatDecimals,
  getStatLabel,
  getStatsForGame,
  getSupportedGames,
  isValidGame,
  isValidStat
} from '../../stat-monitor/registry.js'
import { getUuidIfExists, playerNeverPlayedHypixel, usernameNotExists } from '../common/utility'

const MaxMonitorsPerPlayer = 2

export default class Monitor extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['monitor', 'watch'],
      description: "Monitor a player's stat changes. Notifications sent to guild chat when the stat changes.",
      example: `monitor add %s bedwars FKDR`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const subcommand = context.args[0]?.toLowerCase()

    switch (subcommand) {
      case 'add': {
        return await this.handleAdd(context)
      }
      case 'remove':
      case 'rm':
      case 'delete':
      case 'del': {
        return await this.handleRemove(context)
      }
      case 'list':
      case 'ls': {
        return await this.handleList(context)
      }
      default: {
        const prefix = context.commandPrefix
        return (
          `Usage: ${prefix}monitor add <player> <game> <stat> | ` +
          `${prefix}monitor remove <player> <game> <stat> | ` +
          `${prefix}monitor list | ` +
          `Games: ${getSupportedGames().join(', ')}`
        )
      }
    }
  }

  private async handleAdd(context: ChatCommandContext): Promise<string> {
    const playerArgument = context.args[1]
    const game = context.args[2]?.toLowerCase()
    const stat = context.args[3]?.toUpperCase()

    if (!playerArgument || !game || !stat) {
      return `Usage: ${context.commandPrefix}monitor add <player> <game> <stat>`
    }

    if (!isValidGame(game)) {
      return `Invalid game "${game}". Supported: ${getSupportedGames().join(', ')}`
    }

    if (!isValidStat(game, stat)) {
      return `Invalid stat "${stat}" for ${game}. Supported: ${getStatsForGame(game).join(', ')}`
    }

    const ownerId = context.username

    const count = await context.app.statMonitor.getMonitorCountForOwner(ownerId)
    if (count >= MaxMonitorsPerPlayer) {
      return `You already have ${MaxMonitorsPerPlayer} monitors. Remove one first with ${context.commandPrefix}monitor remove.`
    }

    const uuid = await getUuidIfExists(context.app.mojangApi, playerArgument)
    if (uuid === undefined) return usernameNotExists(context, playerArgument)

    let player
    try {
      player = await context.app.hypixelApi.getPlayer(uuid, {})
    } catch {
      return playerNeverPlayedHypixel(context, playerArgument)
    }

    const currentValue = extractStatValue(player, game, stat)
    if (currentValue === undefined) {
      return `Could not find ${getStatLabel(game, stat) ?? stat} for ${playerArgument}.`
    }

    const decimals = getStatDecimals(game, stat)
    const label = getStatLabel(game, stat) ?? stat
    const playerName = player.nickname

    await context.app.statMonitor.addMonitor(
      ownerId,
      uuid,
      playerName,
      game,
      stat,
      currentValue,
      context.message.bridgeId
    )

    return (
      `Now monitoring ${playerName}'s ${label} (${formatStatValue(currentValue, decimals)}). ` +
      `I'll notify in guild chat when it changes.`
    )
  }

  private async handleRemove(context: ChatCommandContext): Promise<string> {
    const playerArgument = context.args[1]
    const game = context.args[2]?.toLowerCase()
    const stat = context.args[3]?.toUpperCase()

    if (!playerArgument || !game || !stat) {
      return `Usage: ${context.commandPrefix}monitor remove <player> <game> <stat>`
    }

    const uuid = await getUuidIfExists(context.app.mojangApi, playerArgument)
    if (uuid === undefined) return usernameNotExists(context, playerArgument)

    const deleted = await context.app.statMonitor.removeMonitor(context.username, uuid, game, stat)
    if (!deleted) {
      return `No monitor found for ${playerArgument}'s ${game} ${stat}.`
    }

    const label = getStatLabel(game, stat) ?? stat
    return `Stopped monitoring ${playerArgument}'s ${label}.`
  }

  private async handleList(context: ChatCommandContext): Promise<string> {
    const monitors = await context.app.statMonitor.getMonitorsForOwner(context.username)

    if (monitors.length === 0) {
      return `You have no active monitors. Add one with ${context.commandPrefix}monitor add <player> <game> <stat>.`
    }

    const lines = monitors.map(
      (m: { playerName: string; game: string; stat: string; lastValue: number | null }, index: number) => {
        const label = getStatLabel(m.game, m.stat) ?? m.stat
        const value = m.lastValue === null ? '?' : formatStatValue(m.lastValue, getStatDecimals(m.game, m.stat))
        return `${index + 1}. ${m.playerName} - ${m.game} ${label} (${value})`
      }
    )

    return `Active monitors (${monitors.length}/${MaxMonitorsPerPlayer}): ${lines.join(' | ')}`
  }
}
