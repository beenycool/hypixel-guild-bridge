import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const bestiaryView: SkyblockView = {
  name: 'bestiary',
  description: "Returns a player's Bestiary stats",
  example: 'sb %s bestiary dreadlord',
  needsProfile: true,

  // eslint-disable-next-line @typescript-eslint/require-await
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined,
    argumentValues: string[]
  ): Promise<string> {
    assert.ok(selected)
    const bestiaryName = argumentValues.at(0)

    const bestiary = selected.member.bestiary
    if (bestiary === undefined) return `${username} has never killed on this profile.`

    let response = `${username} has `
    response +=
      bestiary.milestone?.last_claimed_milestone === undefined || bestiary.milestone.last_claimed_milestone === 0
        ? 'never claimed bestiary milestones on this profile.'
        : `claimed ${bestiary.milestone.last_claimed_milestone} bestiary milestones.`

    if (bestiaryName !== undefined) {
      const bestiaryStats = Object.keys(bestiary.kills)
        .filter((key) => key !== 'last_killed_mob')
        .filter((key) => key.replaceAll('_', ' ').toLowerCase().includes(bestiaryName.toLowerCase()))
        .map((key) => bestiary.kills[key])
        .reduce((a, b) => a + b, 0)

      if (bestiaryStats === 0) return `${username} has never killed anything like that on this profile.`
      response += ` ${bestiaryStats.toLocaleString('en-US')} total kill on ${bestiaryName}!`
    }

    return response
  }
}
