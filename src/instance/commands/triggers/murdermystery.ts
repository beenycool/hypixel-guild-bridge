import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import {
  formatStatNumber,
  getUuidIfExists,
  playerNeverPlayedHypixel,
  shortenNumber,
  usernameNotExists
} from '../common/utility'

export default class Murdermystery extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['murdermystery', 'mm', 'murder'],
      description: "Returns a player's Murder Mystery stats",
      example: `mm %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    const player = await context.app.hypixelApi.getPlayer(uuid, {}).catch(() => undefined)
    if (player == undefined) return playerNeverPlayedHypixel(context, givenUsername)

    const stats = player.stats?.murdermystery
    if (stats === undefined || stats.playedGames === 0)
      return `${givenUsername} has never played Murder Mystery.`

    const wins = stats.wins ?? 0
    const kills = stats.kills ?? 0
    const deaths = stats.deaths ?? 0
    const kdr = stats.KDRatio ?? 0

    return (
      `${givenUsername}'s Murder Mystery: ` +
      `Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | Deaths: ${shortenNumber(deaths)} | ` +
      `KDR: ${formatStatNumber(kdr)}`
    )
  }
}
