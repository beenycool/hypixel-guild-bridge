import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Quakecraft extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['quakecraft', 'quake', 'qc'],
      description: "Returns a player's Quakecraft stats",
      example: `quakecraft %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.quakecraft
    if (stats === undefined) return `${givenUsername} has never played Quakecraft.`

    const wins = stats.wins
    const kills = stats.kills
    const deaths = stats.deaths
    const KDRatio = stats.KDRatio
    const killstreaks = stats.killstreaks
    const headshots = stats.headshots
    const shotsFired = stats.shotsFired
    const coins = stats.coins

    return (
      `${givenUsername}'s Quakecraft: ` +
      `Kills: ${shortenNumber(kills)} | Wins: ${shortenNumber(wins)} | Deaths: ${shortenNumber(deaths)} | KDR: ${KDRatio.toFixed(2)} | ` +
      `Killstreaks: ${shortenNumber(killstreaks)} | Headshots: ${shortenNumber(headshots)} | Shots Fired: ${shortenNumber(shotsFired)} | Coins: ${shortenNumber(coins)}`
    )
  }
}
