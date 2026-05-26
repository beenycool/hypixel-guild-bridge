import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Murdermystery extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['murdermystery', 'mm', 'murder'],
      description: "Returns a player's Murder Mystery stats",
      example: `mm %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.murdermystery
    if (stats === undefined) return `${givenUsername} has never played Murder Mystery.`

    const wins = stats.wins
    const kills = stats.kills

    return `${givenUsername}'s Murder Mystery: ` + `Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)}`
  }
}
