import type { Player } from 'hypixel-api-reborn'
import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber, shortenNumber } from '../common/utility'

export default class Warlords extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['warlords', 'wl'],
      description: "Returns a player's Warlords stats",
      example: `warlords %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.warlords
    if (stats === undefined) return `${givenUsername} has never played Warlords.`

    const kills = stats.kills
    const deaths = stats.deaths
    const kdr = stats.KDRatio
    const wins = stats.wins
    const assists = stats.assists

    return (
      `${givenUsername}'s Warlords: ` +
      `Kills: ${shortenNumber(kills)} | Deaths: ${shortenNumber(deaths)} | KDR: ${formatStatNumber(kdr)} | ` +
      `Wins: ${shortenNumber(wins)} | Assists: ${shortenNumber(assists)}`
    )
  }
}
