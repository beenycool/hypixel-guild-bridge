import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import {
  formatStatNumber,
  getUuidIfExists,
  playerNeverPlayedHypixel,
  shortenNumber,
  usernameNotExists
} from '../common/utility'

export default class Woolwars extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['woolwars', 'ww'],
      description: "Returns a player's Wool Wars stats",
      example: `ww %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    const player = await context.app.hypixelApi.getPlayer(uuid, {}).catch(() => undefined)
    if (player == undefined) return playerNeverPlayedHypixel(context, givenUsername)

    const woolGames = player.stats?.woolgames
    const woolWars = woolGames?.woolWars
    if (woolWars == undefined || woolWars.gamesPlayed === 0)
      return `${givenUsername} has never played Wool Wars.`

    const level = woolGames?.level ?? 0
    const wins = woolWars.wins ?? 0
    const gamesPlayed = woolWars.gamesPlayed ?? 0
    const woolsPlaced = woolWars.woolsPlaced ?? 0
    const blocksBroken = woolWars.blocksBroken ?? 0
    const kdRatio = woolWars.KDRatio ?? 0

    const wlr = gamesPlayed > 0 ? wins / gamesPlayed : 0
    const wpp = gamesPlayed > 0 ? woolsPlaced / gamesPlayed : 0
    const wpg = blocksBroken > 0 ? woolsPlaced / blocksBroken : 0

    return (
      `[${Math.floor(level)}✫] ${givenUsername}: ` +
      `W: ${shortenNumber(wins)} | WLR: ${formatStatNumber(wlr)} | KDR: ${formatStatNumber(kdRatio)} | ` +
      `BB: ${shortenNumber(blocksBroken)} | WP: ${shortenNumber(woolsPlaced)} | ` +
      `WPP: ${formatStatNumber(wpp)} | WPG: ${formatStatNumber(wpg)}`
    )
  }
}
