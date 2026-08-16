import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { shortenNumber } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const purseView: SkyblockView = {
  name: 'purse',
  description: "Returns a player's skyblock coins",
  example: 'sb %s purse',
  needsProfile: true,
  // eslint-disable-next-line @typescript-eslint/require-await -- SkyblockView contract requires Promise<string>
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)

    const bank = selected.profile.banking?.balance
    const purse = selected.member.currencies?.coin_purse

    if (bank === undefined && purse === undefined) {
      return `${username}'s API is disabled.`
    }

    const totalMessage = shortenNumber((bank ?? 0) + (purse ?? 0))
    const bankMessage = 'Bank ' + (bank === undefined ? 'OFF' : shortenNumber(bank))
    const purseMessage = 'Purse ' + (purse === undefined ? 'OFF' : shortenNumber(purse))

    return `${username}'s coins ${totalMessage} - ${bankMessage} - ${purseMessage}`
  }
}
