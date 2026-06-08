import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class PartyGames extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['partygames', 'pg'],
      description: "Returns a player's Party Games stats",
      example: `pg %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const arcade = player.stats?.arcade as
      | { partyGames?: { wins: number; roundWins: number; stars: number } }
      | undefined
    if (arcade === undefined) return `${givenUsername} has never played Arcade games.`

    const pg = arcade.partyGames
    if (pg === undefined) return `${givenUsername} has never played Party Games.`

    return (
      `${givenUsername}'s Party Games: ` +
      `Wins: ${shortenNumber(pg.wins)} | Round Wins: ${shortenNumber(pg.roundWins)} | Stars: ${shortenNumber(pg.stars)}`
    )
  }
}
