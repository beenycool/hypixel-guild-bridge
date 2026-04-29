import type { Player } from 'hypixel-api-reborn'
import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Arcade extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['arcade', 'arc'],
      description: "Returns a player's Arcade games stats",
      example: `arcade %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.arcade
    if (stats === undefined) return `${givenUsername} has never played Arcade games.`

    const coins = stats.coins

    return `${givenUsername}'s Arcade: Coins: ${shortenNumber(coins)}`
  }
}
