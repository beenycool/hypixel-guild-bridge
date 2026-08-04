import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { formatNumber } from '../../../common/helper-functions.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { playerNeverEnteredCrimson } from '../common/utility'

interface TrophyFishProfile {
  rewards?: number[]
  totalCaught?: number
  [key: string]: number | number[] | undefined
}

const TrophyRanks = ['None', 'Bronze', 'Silver', 'Gold', 'Diamond'] as const

export default class TrophyFish extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['trophyfish', 'trophyfishing', 'trophy', 'tf'],
      description: "Returns a player's trophy fishing stats",
      example: `trophyfish %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const rawProfile = selectedProfile as unknown as Record<string, unknown>
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
