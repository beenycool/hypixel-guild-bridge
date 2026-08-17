import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { shortenNumber } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

const DivineEggs = ['vega', 'starfire', 'orion', 'aurora', 'celestia']
const MythicEggs = [
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

export const eggsView: SkyblockView = {
  name: 'eggs',
  description: "Returns a player's skyblock easter eggs and chocolate stats",
  example: 'sb %s eggs',
  needsProfile: true,

  // eslint-disable-next-line @typescript-eslint/require-await
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)
    const easter = selected.member.events?.easter
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

      for (const mythicEgg of MythicEggs) {
        const count = easter.rabbits[mythicEgg] as undefined | number
        if ((count ?? 0) > 0) {
          mythicEggs++
        }
      }
      for (const divineEgg of DivineEggs) {
        if (((easter.rabbits[divineEgg] as undefined | number) ?? 0) > 0) {
          divineEggs++
        }
      }
    }

    const chocolateSpent = easter?.shop?.chocolate_spent ?? 0
    return (
      `${username} has collected ${totalEggs} chocolate eggs and unlocked ${mythicEggs} mythics and ${divineEggs} divines ` +
      `for a total of ${uniqueEggs}/512 rabbits. ` +
      `Produced ${shortenNumber(totalChocolate)} chocolate, spent ${shortenNumber(chocolateSpent)}.`
    )
  }
}
