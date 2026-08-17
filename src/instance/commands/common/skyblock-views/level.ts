import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { formatStatNumber } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const levelView: SkyblockView = {
  name: 'level',
  description: "Returns a player's skyblock level",
  example: 'sb %s level',
  needsProfile: true,
  // eslint-disable-next-line @typescript-eslint/require-await
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)

    const exp = selected.member.leveling?.experience ?? 0
    const level = exp / 100
    let result = `${username}'s `
    switch (selected.profile.game_mode) {
      case 'ironman': {
        result += 'ironman profile is level '
        break
      }
      case 'bingo': {
        result += 'bingo profile is level '
        break
      }
      case 'island': {
        result += 'stranded profile is level '
        break
      }
      default: {
        result += 'skyblock profile is level '
      }
    }
    result += formatStatNumber(level)

    return result
  }
}
