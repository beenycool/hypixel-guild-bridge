import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { playerNeverEnteredCrimson } from '../common/utility'

export default class Reputation extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['rep', 'reputation', 'faction'],
      description: "Returns a player's crimson isle's faction reputation",
      example: `rep %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    if (
      selectedProfile.nether_island_player_data === undefined ||
      !('selected_faction' in selectedProfile.nether_island_player_data)
    ) {
      return playerNeverEnteredCrimson(username)
    }

    const selectedFaction: string | undefined = selectedProfile.nether_island_player_data.selected_faction
    const mageReputation: number | undefined = selectedProfile.nether_island_player_data.mages_reputation
    const barbarianReputation: number | undefined = selectedProfile.nether_island_player_data.barbarians_reputation

    let message = username

    message +=
      selectedFaction === undefined
        ? ` is not in any faction`
        : ` is in ${selectedFaction.slice(0, 1).toUpperCase() + selectedFaction.slice(1).toLowerCase()} Faction`

    const reputations: string[] = []
    if (barbarianReputation !== undefined) {
      reputations.push(`Barbarian reputation ${barbarianReputation.toLocaleString('en-US')}`)
    }
    if (mageReputation !== undefined) {
      reputations.push(`Mages reputation ${mageReputation.toLocaleString('en-US')}`)
    }
    if (reputations.length > 0) {
      message += ` with ${reputations.join(' - ')}`
    }

    return message
  }
}
