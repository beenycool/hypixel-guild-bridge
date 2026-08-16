import assert from 'node:assert'

import type { SkyblockV2Member, Slayer } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { formatNumber, titleCase } from '../../../../common/helper-functions.js'
import { playerNeverPlayedSlayers } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

const SlayerTypes = ['zombie', 'spider', 'wolf', 'enderman', 'blaze', 'vampire'] as const
type SlayerType = (typeof SlayerTypes)[number]

const SlayerXpTable: Record<SlayerType, number[]> = {
  zombie: [5, 15, 200, 1000, 5000, 20_000, 100_000, 400_000, 1_000_000],
  spider: [5, 25, 200, 1000, 5000, 20_000, 100_000, 400_000, 1_000_000],
  wolf: [5, 30, 250, 1500, 5000, 20_000, 100_000, 400_000, 1_000_000],
  enderman: [10, 30, 250, 1500, 5000, 20_000, 100_000, 400_000, 1_000_000],
  blaze: [10, 30, 250, 1500, 5000, 20_000, 100_000, 400_000, 1_000_000],
  vampire: [20, 75, 240, 840, 2400]
}

interface SlayerLevel {
  xp: number
  level: number
  xpForNext: number
  progress: number
  totalKills: number
  kills: Record<string, number>
}

type SlayerSummary = Record<SlayerType, SlayerLevel>

export const slayerView: SkyblockView = {
  name: 'slayer',
  description: 'Slayer of specified user.',
  example: 'sb %s slayer zombie',
  needsProfile: true,
  // eslint-disable-next-line @typescript-eslint/require-await -- SkyblockView contract requires Promise<string>
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined,
    subcommand: string[]
  ): Promise<string> {
    assert.ok(selected)

    const slayerType = parseSlayerType(subcommand[0])
    const slayerData = getSlayerSummary(selected.member)
    if (!slayerData) return playerNeverPlayedSlayers(username)

    if (slayerType) {
      const data = slayerData[slayerType]
      return `${username}'s ${titleCase(slayerType)} - ${data.level} Levels | ` + `Experience: ${formatNumber(data.xp)}`
    }

    const summary = SlayerTypes.map((type) => {
      const data = slayerData[type]
      return `${titleCase(type)}: ${data.level} (${formatNumber(data.xp)})`
    }).join(' | ')

    return `${username}'s Slayer: ${summary}`
  }
}

function parseSlayerType(value: string | undefined): SlayerType | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  return SlayerTypes.find((type) => type === normalized)
}

function getSlayerSummary(profile: SkyblockV2Member): SlayerSummary | undefined {
  const bosses = profile.slayer?.slayer_bosses
  if (!bosses) return undefined

  return {
    zombie: getSlayerLevel(bosses, 'zombie'),
    spider: getSlayerLevel(bosses, 'spider'),
    wolf: getSlayerLevel(bosses, 'wolf'),
    enderman: getSlayerLevel(bosses, 'enderman'),
    blaze: getSlayerLevel(bosses, 'blaze'),
    vampire: getSlayerLevel(bosses, 'vampire')
  }
}

function getSlayerLevel(bosses: Record<string, Slayer>, slayer: SlayerType): SlayerLevel {
  const slayerData = bosses[slayer]
  const experience = slayerData.xp
  const xpTable = SlayerXpTable[slayer]

  if (experience <= 0) {
    return {
      xp: 0,
      level: 0,
      xpForNext: xpTable[0] ?? 0,
      progress: 0,
      totalKills: 0,
      kills: {}
    }
  }

  let level = 0
  for (const [index, element] of xpTable.entries()) {
    if (element <= experience) level = index + 1
  }

  const maxLevel = xpTable.length
  const xpForNext = level < maxLevel ? Math.ceil(xpTable[level]) : 0
  const progress = xpForNext === 0 ? 0 : Math.max(0, Math.min(experience / xpForNext, 1))

  const { totalKills, kills } = getSlayerKills(slayerData, slayer)

  return {
    xp: experience,
    totalKills,
    level,
    xpForNext,
    progress,
    kills
  }
}

function getSlayerKills(
  slayerData: Slayer | undefined,
  slayer: SlayerType
): { totalKills: number; kills: Record<string, number> } {
  const kills: Record<string, number> = {}
  let total = 0

  if (slayer === 'zombie') kills['5'] = 0
  if (!slayerData) return { totalKills: total, kills }

  for (const [key, value] of Object.entries(slayerData) as [string, unknown][]) {
    if (!key.startsWith('boss_kills_tier_')) continue
    const tier = Number.parseInt(key.slice(-1), 10)
    if (Number.isNaN(tier)) continue

    const killCount = typeof value === 'number' ? value : 0
    total += killCount
    kills[(tier + 1).toString()] = killCount
  }

  return { totalKills: total, kills }
}
