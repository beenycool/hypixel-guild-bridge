import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { getForgeItems } from '../forge.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const forgeView: SkyblockView = {
  name: 'forge',
  description: "Returns a player's forge items",
  example: 'sb %s forge',
  needsProfile: true,

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)
    const forgeItems = getForgeItems(selected.member)
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
