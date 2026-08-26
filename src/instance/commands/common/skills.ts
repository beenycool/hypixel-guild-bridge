import type { SkyblockV2Member, SkyblockV2Profile } from 'hypixel-api-reborn'

import skillsData from '../../../resources/data/skills.json' with { type: 'json' }

export const SkillOrder = skillsData.skillOrder as unknown as readonly [string, ...string[]] & string[]
type SkillName = (typeof SkillOrder)[number]

const CosmeticSkills = new Set<SkillName>(skillsData.cosmeticSkills)

const DefaultSkillCaps: Record<string, number> = skillsData.defaultSkillCaps as Record<string, number>

const MaxedSkillCaps: Record<string, number> = skillsData.maxedSkillCaps as Record<string, number>

const InfiniteLeveling = new Set(skillsData.infiniteLeveling)

const DefaultSkillXpTable = skillsData.defaultSkillXpTable

const RunecraftingXpTable = skillsData.runecraftingXpTable

const SocialXpTable = skillsData.socialXpTable

function getXpTable(type = 'default'): number[] {
  if (type === 'runecrafting') return RunecraftingXpTable
  if (type === 'social') return SocialXpTable
  return DefaultSkillXpTable
}
export interface SkillLevel {
  xp: number
  level: number
  maxLevel: number
  xpCurrent: number
  xpForNext: number
  progress: number
  levelCap: number
  uncappedLevel: number
  levelWithProgress: number
  unlockableLevelWithProgress: number
  maxExperience: number
}

export type Skills = Record<SkillName, SkillLevel>

function getSkillLevelCaps(profile: SkyblockV2Member): Partial<Record<SkillName, number>> {
  return {
    farming: 50 + (profile.jacobs_contest?.perks?.farming_level_cap ?? 0),
    taming: 50 + (profile.pets_data?.pet_care?.pet_types_sacrificed?.length ?? 0),
    runecrafting: 25
  }
}

export function getLevelByXp(xp: number, extra: { type?: string; cap?: number } = {}): SkillLevel {
  const xpTable = getXpTable(extra.type)
  const safeXp = Number.isFinite(xp) ? xp : 0
  const levelCap = extra.cap ?? DefaultSkillCaps[extra.type ?? '']

  let uncappedLevel = 0
  let xpCurrent = safeXp
  let xpRemaining = safeXp

  while (uncappedLevel + 1 < xpTable.length && xpTable[uncappedLevel + 1] <= xpRemaining) {
    uncappedLevel++
    xpRemaining -= xpTable[uncappedLevel]
    if (uncappedLevel <= levelCap) xpCurrent = xpRemaining
  }

  const isInfiniteLevelable = InfiniteLeveling.has(extra.type ?? '')
  if (isInfiniteLevelable) {
    const maxExperience = xpTable.at(-1) ?? 0
    if (maxExperience > 0) {
      uncappedLevel += Math.floor(xpRemaining / maxExperience)
      xpRemaining %= maxExperience
      xpCurrent = xpRemaining
    }
  }

  const maxLevel = isInfiniteLevelable
    ? Math.max(uncappedLevel, levelCap)
    : (MaxedSkillCaps[extra.type ?? ''] ?? levelCap)
  const level = isInfiniteLevelable ? uncappedLevel : Math.min(levelCap, uncappedLevel)
  const fallbackXp = xpTable.at(-1) ?? Infinity
  const xpForNext =
    level < maxLevel ? Math.ceil(xpTable[level + 1] ?? fallbackXp) : isInfiniteLevelable ? fallbackXp : Infinity
  const progress = level >= maxLevel && !isInfiniteLevelable ? 0 : Math.max(0, Math.min(xpCurrent / xpForNext, 1))
  const levelWithProgress = isInfiniteLevelable
    ? uncappedLevel + progress
    : Math.min(uncappedLevel + progress, levelCap)
  const unlockableLevelWithProgress = extra.cap ? Math.min(uncappedLevel + progress, maxLevel) : levelWithProgress
  const maxExperience = getSkillExperience(extra.type, levelCap)

  return {
    xp: safeXp,
    level,
    maxLevel,
    xpCurrent,
    xpForNext,
    progress,
    levelCap,
    uncappedLevel,
    levelWithProgress,
    unlockableLevelWithProgress,
    maxExperience
  }
}

export function getSkillAverage(
  profile: SkyblockV2Member,
  options: { decimals?: number; progress?: boolean; cosmetic?: boolean } = {}
): string {
  const skillLevelCaps = getSkillLevelCaps(profile)
  const decimals = options.decimals ?? 2
  const includeProgress = options.progress ?? false
  const includeCosmetic = options.cosmetic ?? false

  let totalLevel = 0
  let countedSkills = 0

  for (const skillId of SkillOrder) {
    if (!includeCosmetic && CosmeticSkills.has(skillId)) continue

    const xpKey = `SKILL_${skillId.toUpperCase()}`
    const xp = profile.player_data.experience?.[xpKey] ?? 0
    const levelData = getLevelByXp(xp, { type: skillId, cap: skillLevelCaps[skillId] })

    totalLevel += includeProgress ? levelData.levelWithProgress : levelData.level
    countedSkills += 1
  }

  const average = countedSkills > 0 ? totalLevel / countedSkills : 0
  return average.toFixed(decimals)
}

export function getSkills(profile: SkyblockV2Member, profileData: SkyblockV2Profile): Skills | undefined {
  const experience = profile.player_data.experience
  if (experience === undefined) return undefined

  const skillLevelCaps = getSkillLevelCaps(profile)
  const totalSocialXp = getSocialSkillExperience(profileData)

  const skills: Partial<Skills> = {}
  for (const skillId of SkillOrder) {
    const xpKey = `SKILL_${skillId.toUpperCase()}`
    const xp = skillId === 'social' ? totalSocialXp : (experience[xpKey] ?? 0)
    skills[skillId] = getLevelByXp(xp, { type: skillId, cap: skillLevelCaps[skillId] })
  }

  return skills as Skills
}

function getSkillExperience(type: string | undefined, level: number): number {
  const xpTable = getXpTable(type)
  let total = 0
  for (let index = 1; index <= level && index < xpTable.length; index++) {
    total += xpTable[index]
  }
  return total
}

function getSocialSkillExperience(profile: SkyblockV2Profile): number {
  return Object.values(profile.members).reduce((accumulator, member) => {
    return accumulator + (member.player_data.experience?.SKILL_SOCIAL ?? 0)
  }, 0)
}
