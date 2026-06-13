import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Smash extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['smash', 'smashheroes', 'sh'],
      description: "Returns a player's Smash Heroes stats",
      example: `smash %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.smashheroes
    if (stats === undefined) return `${givenUsername} has never played Smash Heroes.` + this.formatPingSuffix()

    const level = stats.level
    const kills = stats.kills
    const deaths = stats.deaths
    const wins = stats.wins

    return (
      `[${level}] ${givenUsername}'s Smash Heroes: ` +
      `Kills: ${shortenNumber(kills)} | Deaths: ${shortenNumber(deaths)} | Wins: ${shortenNumber(wins)}` +
      this.formatPingSuffix()
    )
  }
}
