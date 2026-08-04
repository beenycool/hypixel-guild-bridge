import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { getForgeItems } from '../common/forge'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'

export default class Forge extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['forge'],
      description: "Returns a player's forge items",
      example: `forge %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const forgeItems = getForgeItems(selectedProfile)
    if (forgeItems == undefined) {
      return `${username} has never gone to the Dwarven Mines on this profile.`
    }
    if (forgeItems.length === 0) return `${username} has no items in their forge.`

    const formatted = forgeItems
      .toSorted((a, b) => a.slot - b.slot)
      .map((item) => `${item.slot}: ${item.name}${item.timeFinishedText}`)

    return `${username}'s Forge: ${formatted.join(' | ')}`
  }
}
