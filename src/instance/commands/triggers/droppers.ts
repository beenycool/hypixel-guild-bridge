import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Droppers extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['dropper', 'droppers'],
      description: "Returns a player's Dropper stats",
      example: `dropper %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.arcade?.dropper
    if (stats === undefined) return `${givenUsername} has never played Dropper.` + this.formatPingSuffix()

    const wins = stats.wins
    const games = stats.gamesPlayed
    const flawless = stats.flawlessGames
    const maps = stats.mapsCompleted

    return (
      `${givenUsername}'s Dropper: ` +
      `Wins: ${shortenNumber(wins)} | Games Played: ${shortenNumber(games)} | Flawless: ${shortenNumber(flawless)} | Maps Completed: ${shortenNumber(maps)}` +
      this.formatPingSuffix()
    )
  }
}
