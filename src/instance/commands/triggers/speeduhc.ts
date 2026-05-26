import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber, shortenNumber } from '../common/utility'

export default class Speed extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['speeduhc', 'suhc', 'speed'],
      description: "Returns a player's Speed UHC stats",
      example: `speed %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.speeduhc
    if (stats === undefined) return `${givenUsername} has never played Speed UHC.`

    const kills = stats.kills
    const deaths = stats.deaths
    const kdr = stats.KDRatio
    const wins = stats.wins
    const coins = stats.coins

    return (
      `${givenUsername}'s Speed UHC: ` +
      `Kills: ${shortenNumber(kills)} | Deaths: ${shortenNumber(deaths)} | KDR: ${formatStatNumber(kdr)} | ` +
      `Wins: ${shortenNumber(wins)} | Coins: ${shortenNumber(coins)}`
    )
  }
}
