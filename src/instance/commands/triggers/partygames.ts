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
    const arcade = player.stats?.arcade as Record<string, unknown> | undefined
    if (arcade === undefined) return `${givenUsername} has never played Arcade games.`

    const wins1 = (arcade.wins_party as number) ?? 0
    const wins2 = (arcade.wins_party_2 as number) ?? 0
    const wins3 = (arcade.wins_party_3 as number) ?? 0
    const roundWins = (arcade.round_wins_party as number) ?? 0
    const stars = (arcade.total_stars_party as number) ?? 0

    return (
      `${givenUsername}'s Party Games: ` +
      `1st: ${shortenNumber(wins1)} | 2nd: ${shortenNumber(wins2)} | 3rd: ${shortenNumber(wins3)} | ` +
      `Round Wins: ${shortenNumber(roundWins)} | Stars: ${shortenNumber(stars)}`
    )
  }
}
