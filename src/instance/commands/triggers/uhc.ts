import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber } from '../common/utility'

export default class Uhc extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['uhc'],
      description: "Returns a player's UHC stats",
      example: `uhc %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.uhc
    if (stats === undefined) return `${givenUsername} has never played UHC.` + this.formatPingSuffix()

    const starLevel = stats.starLevel
    const kdRatio = stats.KDRatio
    const wins = stats.wins
    const headsEaten = stats.headsEaten

    return (
      `[${starLevel}✫] ${givenUsername} | KDR: ${formatStatNumber(kdRatio)} | W: ${wins} | Heads: ${headsEaten}` +
      this.formatPingSuffix()
    )
  }
}
