import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

import { calculateDuelsDivision, shortenNumber } from '../common/utility.js'

import { BridgeSubModeAliases } from './duels-bridge-modes.js'
import Duels, { formatBridgeWins, getBridgeStatsFromRawDuels } from './duels.js'

export default class DuelsBridge extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Minigames',
      triggers: ['b'],
      description:
        "Shortcut for 'duels bridge' (bridge duels stats). Supports 'guild' to aggregate Bridge stats for the entire guild.",
      example: `b [mode] %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const underlying = new Duels()

    const firstArgument = context.args[0]?.toLowerCase()

    if (firstArgument === 'guild') {
      return await this.handleGuild(context)
    }

    const subMode = firstArgument ? BridgeSubModeAliases.get(firstArgument) : undefined

    if (subMode) {
      const newContext = {
        ...context,
        args: ['bridge', subMode, ...context.args.slice(1)]
      } as ChatCommandContext
      return await underlying.handler(newContext)
    }

    const newContext = { ...context, args: ['bridge', ...context.args] } as ChatCommandContext
    return await underlying.handler(newContext)
  }
  private async handleGuild(context: ChatCommandContext): Promise<string> {
    const instances = context.app.minecraftManager.getAllInstances()
    const botUuid = instances[0]?.uuid()
    if (!botUuid) return 'No Minecraft instance is connected to fetch guild data.'

    let guild
    try {
      guild = await context.app.hypixelApi.getGuild('player', botUuid, {})
    } catch {
      return 'Failed to fetch guild data.'
    }

    if (!guild || guild.members.length === 0) return 'No guild members found.'

    let wins = 0
    let losses = 0
    let winstreak = 0
    let bestWinstreak = 0
    let fetchedMembers = 0

    // Keep requests deliberately limited because each member requires a raw Hypixel API request.
    const queue = [...guild.members]
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const member = queue.shift()
        if (!member) return

        const rawResponse = (await context.app.hypixelApi
          .getPlayer(member.uuid, { raw: true })
          .catch(() => undefined)) as
          | { player?: { stats?: { Duels?: Record<string, unknown> } } }
          | undefined

        const rawDuels = rawResponse?.player?.stats?.Duels
        if (rawDuels === undefined) continue

        const stats = getBridgeStatsFromRawDuels(rawDuels)
        wins += stats.wins
        losses += stats.losses
        winstreak += stats.winstreak
        bestWinstreak += stats.bestWinstreak
        fetchedMembers++
      }
    }

    // Four workers keeps the command reasonably fast without firing the whole guild at once.
    await Promise.all(Array.from({ length: 4 }, () => worker()))

    const wlr = losses === 0 ? wins : wins / losses
    const division = calculateDuelsDivision(wins, 'long')
    const memberSummary = `${fetchedMembers}/${guild.members.length} members`

    return (
      `[Bridge Guild] [${this.formatDivision(division)}] ${guild.name} ` +
      `(${memberSummary}) ` +
      `W: ${formatBridgeWins(wins)} | L: ${shortenNumber(losses)} | CWS: ${winstreak} | BWS: ${bestWinstreak} | WLR: ${wlr.toFixed(2)}`
    )
  }

  private formatDivision(division: string): string {
    const topTiers = ['celestial', 'divine', 'ascended']
    const lowerDivision = division.toLowerCase()
    for (const tier of topTiers) {
      if (lowerDivision.startsWith(tier)) return division.toUpperCase()
    }
    return division
  }
}
