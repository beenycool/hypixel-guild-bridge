import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { formatStatNumber } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const fairysoulsView: SkyblockView = {
  name: 'fairysouls',
  description: 'Fairy Souls of specified user.',
  example: 'sb %s fairysouls',
  needsProfile: true,

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)
    const total = selected.profile.game_mode === 'island' ? 5 : 253
    const fairySouls = selected.member.fairy_soul
    if (!fairySouls) return `${username} has no fairy soul data or API is off.`

    const collected = fairySouls.total_collected
    const progress = total > 0 ? (collected / total) * 100 : 0

    return `${username}'s Fairy Souls: ${collected} / ${total} | Progress: ${formatStatNumber(progress)}%`
  }
}
