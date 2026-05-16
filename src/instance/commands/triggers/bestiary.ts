import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'

export default class Bestiary extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['be', 'bestiary'],
      description: "Returns a player's Bestiary stats",
      example: `be %s dreadlord`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const bestiaryName = context.args.at(1)

    const bestiary = selectedProfile.bestiary
    if (bestiary === undefined) return `${username} has never killed on this profile.`

    let response = `${username} has `
    response +=
      bestiary.milestone?.last_claimed_milestone === undefined || bestiary.milestone.last_claimed_milestone === 0
        ? 'never claimed bestiary milestones on this profile.'
        : `claimed ${bestiary.milestone.last_claimed_milestone} bestiary milestones.`

    if (bestiaryName !== undefined) {
      const bestiaryStats = Object.keys(bestiary.kills)
        .filter((key) => key !== 'last_killed_mob')
        .filter((key) => key.replaceAll('_', ' ').toLowerCase().includes(bestiaryName.toLowerCase()))
        .map((key) => bestiary.kills[key])
        .reduce((a, b) => a + b, 0)

      if (bestiaryStats === 0) return `${username} has never killed anything like that on this profile.`
      response += ` ${bestiaryStats.toLocaleString('en-US')} total kill on ${bestiaryName}!`
    }

    return response
  }
}
