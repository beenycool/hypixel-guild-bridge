import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'

export default class Eggs extends SkyblockPlayerCommand {
  private static readonly DivineEggs = ['vega', 'starfire', 'orion', 'aurora', 'celestia']
  private static readonly MythicEggs = [
    'dante',
    'einstein',
    'king',
    'galaxy',
    'zorro',
    'mu',
    'napoleon',
    'sigma',
    'omega',
    'zest_zephyr',
    'zeta'
  ]
  constructor() {
    super({
      triggers: ['eggs', 'egg'],
      description: "Returns a player's skyblock easter eggs stats",
      example: `eggs %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const easter = selectedProfile.events?.easter
    const totalChocolate = easter?.total_chocolate ?? 0
    if (totalChocolate === 0) return `${username} does not have a chocolate factory.`

    let totalEggs = 0
    let uniqueEggs = 0
    let mythicEggs = 0
    let divineEggs = 0
    if (easter?.rabbits !== undefined) {
      for (const RabbitEggCount of Object.values(easter.rabbits)) {
        if (typeof RabbitEggCount === 'number') {
          totalEggs += RabbitEggCount
          uniqueEggs++
        }
      }

      for (const mythicEgg of Eggs.MythicEggs) {
        const count = easter.rabbits[mythicEgg] as undefined | number
        if ((count ?? 0) > 0) {
          mythicEggs++
        }
      }
      for (const divineEgg of Eggs.DivineEggs) {
        if (((easter.rabbits[divineEgg] as undefined | number) ?? 0) > 0) {
          divineEggs++
        }
      }
    }

    return `${username} has collected ${totalEggs} chocolate eggs and unlocked ${mythicEggs} mythics and ${divineEggs} divines for a total of ${uniqueEggs}/512 rabbits`
  }
}
