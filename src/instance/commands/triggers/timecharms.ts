import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'

export default class Timecharms extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['timecharm', 'timecharms', 'charm', 'charms', 'riftcharm', 'riftcharms'],
      description: "Returns a player's rift obtained time charms",
      example: `timecharms %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const trophies = selectedProfile.rift?.gallery?.secured_trophies
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
