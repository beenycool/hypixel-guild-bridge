import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber, shortenNumber } from '../common/utility'

export default class Paintball extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['paintball', 'pb'],
      description: "Returns a player's Paintball stats",
      example: `paintball %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.paintball
    if (stats === undefined) return `${givenUsername} has never played Paintball.` + this.formatPingSuffix()

    const kills = stats.kills
    const deaths = stats.deaths
    const kdr = stats.KDRatio
    const wins = stats.wins
    const shotsFired = stats.shotsFired

    return (
      `${givenUsername}'s Paintball: ` +
      `Kills: ${shortenNumber(kills)} | Deaths: ${shortenNumber(deaths)} | KDR: ${formatStatNumber(kdr)} | ` +
      `Wins: ${shortenNumber(wins)} | Shots: ${shortenNumber(shotsFired)}` +
      this.formatPingSuffix()
    )
  }
}
