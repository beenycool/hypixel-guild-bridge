import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { shortenNumber } from '../common/utility'

export default class Accessories extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['accessories', 'acc', 'talismans', 'talisman'],
      description: "Returns a player's accessory bag stats",
      example: `acc %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const accessoryStorage = selectedProfile.accessory_bag_storage
    if (!accessoryStorage) return `${username} has no accessory data or API is off.`

    const magicalPower = accessoryStorage.highest_magical_power

    const selectedPower = accessoryStorage.selected_power ?? 'None'

    // Get tuning stats if available
    const tuning = accessoryStorage.tuning.slot_0
    const tuningStats: string[] = []
    if (tuning) {
      for (const [stat, value] of Object.entries(tuning)) {
        if (value > 0) {
          tuningStats.push(`${stat}: ${value}`)
        }
      }
    }

    const tuningDisplay = tuningStats.length > 0 ? tuningStats.join(', ') : 'None'

    return (
      `${username}'s Accessories: ${shortenNumber(magicalPower)} MP | ` +
      `Power: ${selectedPower} | Tuning: ${tuningDisplay}`
    )
  }
}
