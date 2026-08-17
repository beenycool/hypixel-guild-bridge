import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber, shortenNumber } from '../common/utility'

export default class Pit extends HypixelPlayerCommand {
  constructor() {
    super({
      category: 'Minigames',
      triggers: ['pit', 'thepit'],
      description: "Returns a player's Pit stats",
      example: `pit %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.pit
    if (stats === undefined) return `${givenUsername} has never played The Pit.` + this.formatPingSuffix()

    const kills = stats.kills
    const deaths = stats.deaths
    const kdr = deaths > 0 ? kills / deaths : kills
    const playtime = stats.playtime

    return (
      `${givenUsername}'s Pit: ` +
      `Kills: ${shortenNumber(kills)} | Deaths: ${shortenNumber(deaths)} | ` +
      `KDR: ${formatStatNumber(kdr)} | Playtime: ${Math.floor(playtime / 60)}h` +
      this.formatPingSuffix()
    )
  }
}
