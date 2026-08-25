import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Blitz extends HypixelPlayerCommand {
  constructor() {
    super({
      category: 'Minigames',
      triggers: ['blitz', 'hungergames', 'hg', 'sg'],
      description: "Returns a player's Blitz Survival Games stats",
      example: `blitz %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.blitzsg
    if (stats === undefined) return `${givenUsername} has never played Blitz SG.` + this.formatPingSuffix()

    const kills = stats.kills
    const wins = stats.wins
    const coins = stats.coins

    return (
      `${givenUsername}'s Blitz SG: ` +
      `Kills: ${shortenNumber(kills)} | Wins: ${shortenNumber(wins)} | Coins: ${shortenNumber(coins)}` +
      this.formatPingSuffix()
    )
  }
}
