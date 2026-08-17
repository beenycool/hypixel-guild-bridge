import assert from 'node:assert'

import type { Client, SkyblockMember, SkyblockV2Member, SkyblockV2Profile } from 'hypixel-api-reborn'

import { httpClient } from '../../../common/http.js'
import type { MojangApi } from '../../../core/users/mojang'

import type { ChatCommandContext } from 'src/common/commands'

export async function getUuidIfExists(mojangApi: MojangApi, username: string): Promise<string | undefined> {
  try {
    const profile = await mojangApi.profileByUsername(username)
    return profile.id
  } catch {
    return undefined
  }
}

export async function getSelectedSkyblockProfileRaw(
  hypixelApi: Client,
  uuid: string
): Promise<SkyblockV2Member | undefined> {
  const response = await hypixelApi.getSkyblockProfiles(uuid, { raw: true })

  if (!response.profiles) return undefined
  const profile = response.profiles.find((p) => p.selected)

  const selected = profile?.members[uuid]
  assert.ok(selected)
  return selected
}

export async function getSelectedSkyblockProfileData(
  hypixelApi: Client,
  uuid: string
): Promise<{ profile: SkyblockV2Profile; member: SkyblockV2Member } | undefined> {
  const response = await hypixelApi.getSkyblockProfiles(uuid, { raw: true })

  if (!response.profiles) return undefined
  const profile = response.profiles.find((p) => p.selected)
  if (!profile) return undefined

  const member = profile.members[uuid]

  return { profile, member }
}

export async function getSelectedSkyblockProfile(hypixelApi: Client, uuid: string): Promise<SkyblockMember> {
  return await hypixelApi.getSkyblockProfiles(uuid).then((profiles) => {
    const profile = profiles.find((profile) => profile.selected)?.me
    assert.ok(profile)
    return profile
  })
}

export function getDungeonLevelWithOverflow(experience: number): number {
  const DungeonXp = [
    50, 75, 110, 160, 230, 330, 470, 670, 950, 1340, 1890, 2665, 3760, 5260, 7380, 10_300, 14_400, 20_000, 27_600,
    38_000, 52_500, 71_500, 97_000, 132_000, 180_000, 243_000, 328_000, 445_000, 600_000, 800_000, 1_065_000, 1_410_000,
    1_900_000, 2_500_000, 3_300_000, 4_300_000, 5_600_000, 7_200_000, 9_200_000, 1.2e7, 1.5e7, 1.9e7, 2.4e7, 3e7, 3.8e7,
    4.8e7, 6e7, 7.5e7, 9.3e7, 1.1625e8
  ]
  const PerLevel = 200_000_000
  const Max50Xp = 569_809_640

  if (experience > Max50Xp) {
    const remainingExperience = experience - Max50Xp
    const extraLevels = Math.floor(remainingExperience / PerLevel)
    const fractionLevel = (remainingExperience % PerLevel) / PerLevel

    return 50 + extraLevels + fractionLevel
  }

  let totalLevel = 0
  let remainingXP = experience

  for (const [index, levelXp] of DungeonXp.entries()) {
    if (remainingXP > levelXp) {
      totalLevel = index + 1
      remainingXP -= levelXp
    } else {
      break
    }
  }

  const fractionLevel = remainingXP / DungeonXp[totalLevel]
  return totalLevel + fractionLevel
}

export function shortenNumber(value: number): string {
  if (value === 0) return value.toFixed(0)
  let suffix = ''

  if (value > 1000) {
    value = value / 1000
    suffix = 'k'
  }
  if (value > 1000) {
    value = value / 1000
    suffix = 'm'
  }
  if (value > 1000) {
    value = value / 1000
    suffix = 'b'
  }
  if (value > 1000) {
    value = value / 1000
    suffix = 't'
  }

  const digits = Math.floor(Math.log10(Math.abs(value))) + 1
  const digitsCount = 3

  return value.toFixed(Math.max(0, digitsCount - digits)) + suffix
}

export function formatStatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(decimals)
}

export interface AuroraPingEntry {
  avg: number
  min: number
  max: number
  day: string
}

const AuroraPingBaseUrl = 'https://bordic.xyz/api/v2/resources/ping'

export async function fetchAuroraPing(uuid: string, apiKey: string): Promise<AuroraPingEntry | undefined> {
  try {
    const url = `${AuroraPingBaseUrl}?key=${encodeURIComponent(apiKey)}&uuid=${uuid}`
    const response = await httpClient.get<{ success: boolean; data?: AuroraPingEntry[] }>(url, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'User-Agent': 'Hypixel-Guild-Discord-Bridge-Ping/1.0.0' }
    })
    if (!response.data.success || !response.data.data || response.data.data.length === 0) return undefined
    return response.data.data[0]
  } catch {
    return undefined
  }
}

export interface AuroraWinstreakData {
  uuid: string
  winstreak: number
  // eslint-disable-next-line @typescript-eslint/naming-convention
  accurate_winstreak: number | null
  estimated: boolean
  confirmed: number
}

const AuroraWinstreakBaseUrl = 'https://bordic.xyz/api/v2/resources/winstreak'

export async function fetchAuroraWinstreak(uuid: string, apiKey: string): Promise<AuroraWinstreakData | undefined> {
  try {
    const url = `${AuroraWinstreakBaseUrl}?key=${encodeURIComponent(apiKey)}&uuid=${uuid}`
    const response = await httpClient.get<{ success: boolean; data?: AuroraWinstreakData }>(url, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'User-Agent': 'Hypixel-Guild-Discord-Bridge-AuroraApi/1.0.0' }
    })
    if (!response.data.success || !response.data.data) return undefined
    return response.data.data
  } catch {
    return undefined
  }
}

export function capitalize(name: string): string {
  return name.slice(0, 1).toUpperCase() + name.slice(1).toLowerCase()
}

export function usernameNotExists(context: ChatCommandContext, givenUsername: string): string {
  return context.app.i18n.t(($) => $['commands.error.username-not-exists'], { username: givenUsername })
}

export function canOnlyUseIngame(context: ChatCommandContext): string {
  return context.app.i18n.t(($) => $['commands.error.must-be-ingame'], { username: context.username })
}

export function playerNeverPlayedHypixel(context: ChatCommandContext, username: string): string {
  return context.app.i18n.t(($) => $['commands.error.never-joined-hypixel'], { username: username })
}

export function playerNeverPlayedSkyblock(context: ChatCommandContext, username: string): string {
  return context.app.i18n.t(($) => $['commands.error.never-joined-skyblock'], { username: username })
}

export function playerNeverPlayedDungeons(username: string): string {
  return `${username} has never played dungeons before?`
}

export function playerNeverPlayedSlayers(username: string): string {
  return `${username} has never done slayers before?`
}

export function playerNeverEnteredCrimson(username: string): string {
  return `${username} has never entered Crimson Isle before?`
}

interface DivisionThreshold {
  tier: string
  maxLevel: number
  increment: number
}

const DuelsDivisionThresholds: readonly DivisionThreshold[] = [
  { tier: 'Rookie', maxLevel: 5, increment: 10 },
  { tier: 'Iron', maxLevel: 5, increment: 30 },
  { tier: 'Gold', maxLevel: 5, increment: 50 },
  { tier: 'Diamond', maxLevel: 5, increment: 100 },
  { tier: 'Master', maxLevel: 5, increment: 200 },
  { tier: 'Legend', maxLevel: 5, increment: 600 },
  { tier: 'Grandmaster', maxLevel: 5, increment: 1000 },
  { tier: 'Godlike', maxLevel: 5, increment: 3000 },
  { tier: 'Celestial', maxLevel: 5, increment: 5000 },
  { tier: 'Divine', maxLevel: 5, increment: 10_000 },
  { tier: 'Ascended', maxLevel: 50, increment: 10_000 }
] as const

const DivisionStartWins: readonly number[] = [
  50, 100, 250, 500, 1000, 2000, 5000, 10_000, 25_000, 50_000, 100_000
] as const

const DivisionIncrements: readonly number[] = [10, 30, 50, 100, 200, 600, 1000, 3000, 5000, 10_000, 10_000] as const

export type DuelsDivisionMode = 'short' | 'long' | 'overall'

function romanNumeral(romanValue: number): string {
  const numerals: Record<number, string> = {
    [1]: 'I',
    [2]: 'II',
    [3]: 'III',
    [4]: 'IV',
    [5]: 'V',
    [6]: 'VI',
    [7]: 'VII',
    [8]: 'VIII',
    [9]: 'IX',
    [10]: 'X',
    [11]: 'XI',
    [12]: 'XII',
    [13]: 'XIII',
    [14]: 'XIV',
    [15]: 'XV',
    [16]: 'XVI',
    [17]: 'XVII',
    [18]: 'XVIII',
    [19]: 'XIX',
    [20]: 'XX',
    [21]: 'XXI',
    [22]: 'XXII',
    [23]: 'XXIII',
    [24]: 'XXIV',
    [25]: 'XXV',
    [26]: 'XXVI',
    [27]: 'XXVII',
    [28]: 'XXVIII',
    [29]: 'XXIX',
    [30]: 'XXX',
    [31]: 'XXXI',
    [32]: 'XXXII',
    [33]: 'XXXIII',
    [34]: 'XXXIV',
    [35]: 'XXXV',
    [36]: 'XXXVI',
    [37]: 'XXXVII',
    [38]: 'XXXVIII',
    [39]: 'XXXIX',
    [40]: 'XL',
    [41]: 'XLI',
    [42]: 'XLII',
    [43]: 'XLIII',
    [44]: 'XLIV',
    [45]: 'XLV',
    [46]: 'XLVI',
    [47]: 'XLVII',
    [48]: 'XLVIII',
    [49]: 'XLIX',
    [50]: 'L'
  }
  return numerals[romanValue] ?? romanValue.toString()
}

export function calculateDuelsDivision(wins: number, mode: DuelsDivisionMode): string {
  let effectiveWins: number
  if (mode === 'long') {
    effectiveWins = wins * 2
  } else if (mode === 'overall') {
    effectiveWins = Math.floor(wins / 2)
  } else {
    effectiveWins = wins
  }

  for (let tierIndex = 0; tierIndex < DuelsDivisionThresholds.length; tierIndex++) {
    const threshold = DuelsDivisionThresholds[tierIndex]
    const startWins = DivisionStartWins[tierIndex]
    const maxIndex = DuelsDivisionThresholds.length - 1
    const nextTierStart = tierIndex < maxIndex ? DivisionStartWins[tierIndex + 1] : Infinity

    if (effectiveWins >= startWins && effectiveWins < nextTierStart) {
      const levelWins = effectiveWins - startWins
      const levelNumber = Math.floor(levelWins / DivisionIncrements[tierIndex])
      const actualLevel = Math.min(levelNumber + 1, threshold.maxLevel)
      return `${threshold.tier} ${romanNumeral(actualLevel)}`
    }
  }

  return 'Unranked'
}
