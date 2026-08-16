import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const timecharmsView: SkyblockView = {
  name: 'timecharms',
  description: "Returns a player's rift obtained time charms",
  example: 'sb %s timecharms',
  needsProfile: true,

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)
    const trophies = selected.member.rift?.gallery?.secured_trophies
    if (trophies === undefined || trophies.length === 0) {
      return `${username} has not secured any timecharm yet?`
    }

    let lastCharm = trophies[0]
    for (const trophy of trophies) {
      if (lastCharm.timestamp < trophy.timestamp) lastCharm = trophy
    }

    let displayName: string
    switch (lastCharm.type) {
      case 'wyldly_supreme': {
        displayName = 'Supreme Timecharm (Black Lagoon)'
        break
      }
      case 'chicken_n_egg': {
        displayName = 'Chicken N Egg Timecharm (West Village)'
        break
      }
      case 'mirrored': {
        displayName = 'mrahcemiT esrevrorriM (West Village)'
        break
      }
      case 'citizen': {
        displayName = 'SkyBlock Citizen Timecharm (Village Plaza)'
        break
      }
      case 'lazy_living': {
        displayName = 'Living Timecharm (Living Cave)'
        break
      }
      case 'slime': {
        displayName = 'Globulate Timecharm (Colosseum)'
        break
      }
      case 'vampiric': {
        displayName = 'Vampiric Timecharm (Stillgore Château)'
        break
      }
      case 'mountain': {
        displayName = 'Celestial Timecharm (Cerebral Citadel)'
      }
    }

    return `${username} obtained ${displayName} - Total ${trophies.length}`
  }
}
