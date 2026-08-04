import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Tntgames extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['tntgames', 'tnt'],
      description: "Returns a player's TNT Games stats",
      example: `tnt %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.tntgames
    if (stats === undefined) return `${givenUsername} has never played TNT Games.` + this.formatPingSuffix()

    const wins = stats.wins
    const coins = stats.coins

    return (
      `${givenUsername}'s TNT Games: Wins: ${shortenNumber(wins)} | Coins: ${shortenNumber(coins)}` +
      this.formatPingSuffix()
    )
  }
}
