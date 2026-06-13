import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber, shortenNumber } from '../common/utility'

export default class Megawalls extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['megawalls', 'mw'],
      description: "Returns a player's Megawalls stats",
      example: `mw %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.megawalls
    if (stats === undefined) return `${givenUsername} has never played Megawalls.` + this.formatPingSuffix()

    const selectedClass = stats.selectedClass ?? 'None'
    const finalKills = stats.finalKills
    const finalKDRatio = stats.finalKDRatio
    const wins = stats.wins
    const wlRatio = stats.WLRatio
    const kills = stats.kills
    const kdRatio = stats.KDRatio
    const assists = stats.assists

    return (
      `${givenUsername}'s Megawalls: Class: ${selectedClass} | ` +
      `FK: ${shortenNumber(finalKills)} FKDR: ${formatStatNumber(finalKDRatio)} | ` +
      `W: ${shortenNumber(wins)} WLR: ${formatStatNumber(wlRatio)} | ` +
      `K: ${shortenNumber(kills)} KDR: ${formatStatNumber(kdRatio)} | A: ${shortenNumber(assists)}` +
      this.formatPingSuffix()
    )
  }
}
