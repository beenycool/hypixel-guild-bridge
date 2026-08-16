import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { playerNeverEnteredCrimson, shortenNumber } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const crimsonView: SkyblockView = {
  name: 'crimson',
  description: "Returns a player's Crimson Isle stats (faction, reputation, Kuudra)",
  example: 'sb %s crimson | sb %s crimson kuudra',
  needsProfile: true,

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract requires Promise<string>
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined,
    argumentValues: string[]
  ): Promise<string> {
    assert.ok(selected)

    if (argumentValues[0]?.toLowerCase() === 'kuudra') {
      if (!selected.member.nether_island_player_data) return playerNeverEnteredCrimson(username)
      const tiers = selected.member.nether_island_player_data.kuudra_completed_tiers

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

    const netherData = selected.member.nether_island_player_data
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
