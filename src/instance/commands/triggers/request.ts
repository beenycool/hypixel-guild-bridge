import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatNumber } from '../../../common/helper-functions.js'
import { getUuidIfExists, usernameNotExists } from '../common/utility.js'

export default class RequestCommand extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['req', 'requirements'],
      description: 'Check if a player meets the guild requirements',
      example: 'req %s'
    })
  }

  public async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username

    const config = context.app.config.guildRequirements
    if (!config?.enabled) return 'Guild requirements are not configured.'

    let uuid = context.apiCache.getMojangUuid(givenUsername)
    if (uuid === undefined) {
      uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
      if (uuid !== undefined) context.apiCache.setMojangUuid(givenUsername, uuid)
    }
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    let player = context.apiCache.getHypixelPlayer(uuid)
    if (player === undefined) {
      try {
        player = await context.app.hypixelApi.getPlayer(uuid, {})
        context.apiCache.setHypixelPlayer(uuid, player)
      } catch {
        return 'Failed to fetch player data from Hypixel API.'
      }
    }

    const reqs = config.requirements
    const bedwarsStars = player.stats?.bedwars?.level ?? 0
    const bedwarsFKDR = player.stats?.bedwars?.finalKDRatio ?? 0
    const skywarsStars = player.stats?.skywars?.level ?? 0
    const skywarsKDR = player.stats?.skywars?.KDRatio ?? 0
    const duelsWins = player.stats?.duels?.wins ?? 0
    const duelsWLR = player.stats?.duels?.WLRatio ?? 0

    const meetsAnyRequirement = [
      reqs.bedwarsStars > 0 && bedwarsStars >= reqs.bedwarsStars,
      reqs.bedwarsFKDR > 0 && bedwarsFKDR >= reqs.bedwarsFKDR,
      reqs.skywarsStars > 0 && skywarsStars >= reqs.skywarsStars,
      reqs.skywarsKDR > 0 && skywarsKDR >= reqs.skywarsKDR,
      reqs.duelsWins > 0 && duelsWins >= reqs.duelsWins,
      reqs.duelsWLR > 0 && duelsWLR >= reqs.duelsWLR
    ].some(Boolean)

    const results: string[] = []
    if (reqs.bedwarsStars > 0) {
      results.push(`BW Stars: ${bedwarsStars}/${reqs.bedwarsStars} ${bedwarsStars >= reqs.bedwarsStars ? '✅' : '❌'}`)
    }
    if (reqs.bedwarsFKDR > 0) {
      results.push(
        `BW FKDR: ${formatNumber(bedwarsFKDR, 2)}/${reqs.bedwarsFKDR} ${bedwarsFKDR >= reqs.bedwarsFKDR ? '✅' : '❌'}`
      )
    }
    if (reqs.skywarsStars > 0) {
      results.push(`SW Stars: ${skywarsStars}/${reqs.skywarsStars} ${skywarsStars >= reqs.skywarsStars ? '✅' : '❌'}`)
    }
    if (reqs.skywarsKDR > 0) {
      results.push(
        `SW KDR: ${formatNumber(skywarsKDR, 2)}/${reqs.skywarsKDR} ${skywarsKDR >= reqs.skywarsKDR ? '✅' : '❌'}`
      )
    }
    if (reqs.duelsWins > 0) {
      results.push(
        `Duels Wins: ${duelsWins.toLocaleString()}/${reqs.duelsWins.toLocaleString()} ${duelsWins >= reqs.duelsWins ? '✅' : '❌'}`
      )
    }
    if (reqs.duelsWLR > 0) {
      results.push(
        `Duels WLR: ${formatNumber(duelsWLR, 2)}/${reqs.duelsWLR} ${duelsWLR >= reqs.duelsWLR ? '✅' : '❌'}`
      )
    }

    return `${givenUsername} ${meetsAnyRequirement ? 'MEETS' : 'DOES NOT MEET'} requirements. ${results.join(' | ')}`
  }
}
