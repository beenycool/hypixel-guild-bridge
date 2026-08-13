import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Tnttag extends HypixelPlayerCommand {
  constructor() {
    super({
      category: 'Minigames',
      triggers: ['tnttag'],
      description: "Returns a player's TNT Tag stats",
      example: `tnttag %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const tntGames = player.stats?.tntgames
    if (tntGames === undefined) return `${givenUsername} has never played TNT Tag.` + this.formatPingSuffix()

    const tnttag = tntGames.tnttag
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: Hypixel API may omit fields despite the types
    if (tnttag?.wins === undefined) return `${givenUsername} has never played TNT Tag.` + this.formatPingSuffix()

    const wins = tnttag.wins
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: Hypixel API may omit fields despite the types
    const kills = tnttag.kills ?? 0
    const deaths = (tnttag as { deaths?: number }).deaths ?? 0
    const kdr = deaths > 0 ? (kills / deaths).toFixed(2) : kills > 0 ? '\u221E' : '0.00'

    return (
      `${givenUsername}'s TNT Tag: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | Deaths: ${shortenNumber(deaths)} | K/D: ${kdr}` +
      this.formatPingSuffix()
    )
  }
}
