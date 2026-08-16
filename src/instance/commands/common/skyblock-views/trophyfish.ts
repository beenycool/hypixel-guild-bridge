import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { formatNumber } from '../../../../common/helper-functions.js'
import { playerNeverEnteredCrimson } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

interface TrophyFishProfile {
  rewards?: number[]
  totalCaught?: number
  [key: string]: number | number[] | undefined
}

const TrophyRanks = ['None', 'Bronze', 'Silver', 'Gold', 'Diamond'] as const

export const trophyfishView: SkyblockView = {
  name: 'trophyfish',
  description: "Returns a player's trophy fishing stats",
  example: 'sb %s trophyfish',
  needsProfile: true,

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)
    const rawProfile = selected.member as unknown as Record<string, unknown>
    const trophyFish = rawProfile.trophy_fish as TrophyFishProfile | undefined
    if (!trophyFish) return playerNeverEnteredCrimson(username)

    const trophyKeys = Object.keys(trophyFish)
    const rewards = Array.isArray(trophyFish.rewards) ? trophyFish.rewards : []
    const lastReward = rewards.at(-1)
    const rankIndex = typeof lastReward === 'number' ? lastReward : 0
    const rank = TrophyRanks[rankIndex] ?? TrophyRanks[0]

    const totalCaughtKey = 'total_caught'
    const caughtTotal = ((trophyFish as Record<string, unknown>)[totalCaughtKey] as number | undefined) ?? 0
    const bronze = trophyKeys.filter((key) => key.endsWith('_bronze')).length
    const silver = trophyKeys.filter((key) => key.endsWith('_silver')).length
    const gold = trophyKeys.filter((key) => key.endsWith('_gold')).length
    const diamond = trophyKeys.filter((key) => key.endsWith('_diamond')).length

    return (
      `${username}'s Trophy Fishing rank: ${rank} | ` +
      `Caught: ${formatNumber(caughtTotal)} | ` +
      `Bronze: ${formatNumber(bronze)} / 18 | ` +
      `Silver: ${formatNumber(silver)} / 18 | ` +
      `Gold: ${formatNumber(gold)} | ` +
      `Diamond: ${formatNumber(diamond)} / 18`
    )
  }
}
