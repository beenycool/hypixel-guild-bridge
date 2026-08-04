import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { playerNeverEnteredCrimson } from '../common/utility'

export default class Kuudra extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['kuudra', 'k'],
      description: "Returns a player's kuudra runs",
      example: `kuudra %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    if (!selectedProfile.nether_island_player_data) return playerNeverEnteredCrimson(username)
    const tiers = selectedProfile.nether_island_player_data.kuudra_completed_tiers

    const entries: string[] = []
    if (tiers.none) entries.push(`Basic ${tiers.none}`)
    if (tiers.hot) entries.push(`Hot ${tiers.hot}`)
    if (tiers.burning) entries.push(`Burning ${tiers.burning}`)
    if (tiers.fiery) entries.push(`Fiery ${tiers.fiery}`)
    if (tiers.infernal) entries.push(`Infernal ${tiers.infernal}`)

    if (entries.length === 0) return `${username} has never done Kuudra before?`

    const collection =
      (tiers.none ?? 1) +
      (tiers.hot ?? 0) * 2 +
      (tiers.burning ?? 0) * 3 +
      (tiers.fiery ?? 0) * 4 +
      (tiers.infernal ?? 0) * 5

    return `${username}: ${entries.join(' - ')} - Collection ${collection.toLocaleString('en-US')}`
  }
}
