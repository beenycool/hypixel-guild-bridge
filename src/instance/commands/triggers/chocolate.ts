import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Chocolate extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['chocolate', 'chocolates', 'cf'],
      description: "Returns a player's skyblock easter eggs chocolate stats",
      example: `chocolate %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const easter = selectedProfile.events?.easter
    const totalChocolate = easter?.total_chocolate ?? 0
    const chocolateSpent = easter?.shop?.chocolate_spent ?? 0
    if (totalChocolate === 0) return `${username} does not have a chocolate factory.`

    return `${username} has produced ${shortenNumber(totalChocolate)} chocolate and spent ${shortenNumber(chocolateSpent)}.`
  }
}
