import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber, shortenNumber } from '../common/utility'

export default class Cops extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['copsandcrims', 'cac', 'mcgo', 'cops'],
      description: "Returns a player's Cops and Crims stats",
      example: `cops %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.copsandcrims
    if (stats === undefined) return `${givenUsername} has never played Cops and Crims.` + this.formatPingSuffix()

    const kills = stats.kills
    const deaths = stats.deaths
    const kdr = stats.KDRatio
    const wins = stats.wins
    const headshotKills = stats.headshotKills

    return (
      `${givenUsername}'s Cops&Crims: ` +
      `Kills: ${shortenNumber(kills)} | Deaths: ${shortenNumber(deaths)} | KDR: ${formatStatNumber(kdr)} | ` +
      `Wins: ${shortenNumber(wins)} | Headshots: ${shortenNumber(headshotKills)}` +
      this.formatPingSuffix()
    )
  }
}
