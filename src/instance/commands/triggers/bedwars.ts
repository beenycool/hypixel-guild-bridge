import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { capitalize, formatStatNumber, shortenNumber } from '../common/utility'

type BedwarsMode = 'overall' | 'solo' | 'doubles' | 'threes' | 'fours' | '4v4'

export default class Bedwars extends HypixelPlayerCommand {
  private static readonly ValidModes: readonly BedwarsMode[] = ['overall', 'solo', 'doubles', 'threes', 'fours', '4v4']
  constructor() {
    super({
      triggers: ['bedwars', 'bw', 'bws'],
      description: "Returns a player's Bed Wars stats with optional mode filter",
      example: `bw [mode] %s`
    })
  }

  protected override resolveUsername(context: ChatCommandContext): string {
    return this.parseArgs(context).username
  }

  private parseArgs(context: ChatCommandContext): { mode: BedwarsMode; username: string } {
    const firstArgument = context.args[0]?.toLowerCase()
    const isFirstArgumentMode = firstArgument && Bedwars.ValidModes.includes(firstArgument as BedwarsMode)
    return {
      mode: isFirstArgumentMode ? (firstArgument as BedwarsMode) : 'overall',
      username: isFirstArgumentMode ? (context.args[1] ?? context.username) : (context.args[0] ?? context.username)
    }
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const { mode } = this.parseArgs(context)

    const stats = player.stats?.bedwars
    if (stats === undefined) return `${givenUsername} has never played Bed Wars before?`

    const modeStats = mode === 'overall' ? stats : (stats as unknown as Record<string, unknown>)[mode]
    if (modeStats === undefined) {
      return `${givenUsername} has no ${capitalize(mode)} Bed Wars stats.`
    }

    const level = stats.level
    const finalKills = this.getStat(modeStats, 'finalKills') ?? 0
    const finalKDRatio = this.getStat(modeStats, 'finalKDRatio') ?? 0
    const wins = this.getStat(modeStats, 'wins') ?? 0
    const wlRatio = this.getStat(modeStats, 'WLRatio') ?? 0
    const bedsBroken = this.getStat(modeStats, 'beds', 'broken') ?? 0
    const blRatio = this.getStat(modeStats, 'beds', 'BLRatio') ?? 0
    const winstreak = this.getStat(modeStats, 'winstreak') ?? 0

    const modePrefix = mode === 'overall' ? '' : `${capitalize(mode)} `

    return (
      `[${level.toFixed(0)}✫] ${givenUsername} ${modePrefix}` +
      `FK: ${shortenNumber(finalKills)} FKDR: ${formatStatNumber(finalKDRatio)} ` +
      `W: ${shortenNumber(wins)} WLR: ${formatStatNumber(wlRatio)} ` +
      `BB: ${shortenNumber(bedsBroken)} BLR: ${formatStatNumber(blRatio)} ` +
      `WS: ${winstreak}`
    )
  }

  private getStat(object: unknown, ...keys: string[]): number | undefined {
    let current: unknown = object
    for (const key of keys) {
      if (current === null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[key]
    }
    return typeof current === 'number' ? current : undefined
  }
}
