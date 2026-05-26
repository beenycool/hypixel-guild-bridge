import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { formatStatNumber } from '../common/utility'

export default class Sblevel extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['sblevel', 'sblvl'],
      description: "Returns a player's Skyblock level",
      example: `sblevel %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const experience = selectedProfile.leveling?.experience ?? 0
    const level = experience > 0 ? experience / 100 : 0

    return `${username}'s Skyblock Level: ${formatStatNumber(level)}`
  }
}
