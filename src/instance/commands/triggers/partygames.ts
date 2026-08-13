import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class PartyGames extends HypixelPlayerCommand {
  constructor() {
    super({
      category: 'Minigames',
      triggers: ['partygames', 'pg'],
      description: "Returns a player's Party Games stats",
      example: `pg %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const arcade = player.stats?.arcade as
      | { partyGames?: { wins: number; roundWins: number; stars: number } }
      | undefined
    if (arcade === undefined) return `${givenUsername} has never played Arcade games.` + this.formatPingSuffix()

    const pg = arcade.partyGames
    if (pg === undefined) return `${givenUsername} has never played Party Games.` + this.formatPingSuffix()

    return (
      `${givenUsername}'s Party Games: ` +
      `Wins: ${shortenNumber(pg.wins)} | Round Wins: ${shortenNumber(pg.roundWins)} | Stars: ${shortenNumber(pg.stars)}` +
      this.formatPingSuffix()
    )
  }
}
