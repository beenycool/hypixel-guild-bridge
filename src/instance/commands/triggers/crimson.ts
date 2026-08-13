import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { playerNeverEnteredCrimson, shortenNumber } from '../common/utility'

export default class Crimson extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['crimson', 'nether', 'isle', 'rep', 'reputation', 'faction'],
      description: "Returns a player's Crimson Isle stats (faction, reputation, Kuudra)",
      example: `crimson %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const netherData = selectedProfile.nether_island_player_data
    if (!netherData) return playerNeverEnteredCrimson(username)

    const faction = netherData.selected_faction ?? 'None'
    const magesRep = netherData.mages_reputation ?? 0
    const barbariansRep = netherData.barbarians_reputation ?? 0

    const kuudraTiers = netherData.kuudra_completed_tiers
    const totalKuudra =
      (kuudraTiers.none ?? 0) +
      (kuudraTiers.hot ?? 0) +
      (kuudraTiers.burning ?? 0) +
      (kuudraTiers.fiery ?? 0) +
      (kuudraTiers.infernal ?? 0)

    return (
      `${username}'s Crimson Isle: Faction: ${faction} | ` +
      `Mages Rep: ${shortenNumber(magesRep)} | Barbs Rep: ${shortenNumber(barbariansRep)} | ` +
      `Total Kuudra: ${totalKuudra}`
    )
  }
}
