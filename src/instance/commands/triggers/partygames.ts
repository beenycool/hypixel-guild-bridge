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

    const wins1 = (arcade.party_games_wins_1 as number) ?? 0
    const wins2 = (arcade.party_games_wins_2 as number) ?? 0
    const wins3 = (arcade.party_games_wins_3 as number) ?? 0
    const played = (arcade.party_games_played as number) ?? 0
    const finisher = (arcade.party_games_finisher as number) ?? 0

    return (
      `${givenUsername}'s Party Games: ` +
      `W1: ${shortenNumber(wins1)} | W2: ${shortenNumber(wins2)} | W3: ${shortenNumber(wins3)} | ` +
      `Played: ${shortenNumber(played)} | Finisher: ${shortenNumber(finisher)}`
    )
  }
}
