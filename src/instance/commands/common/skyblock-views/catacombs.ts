import assert from 'node:assert'

import type {
  DungeonFloors,
  DungeonFloorsWithEntrance,
  SkyblockV2Dungeons,
  SkyblockV2DungeonsTypes,
  SkyblockV2Member
} from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { formatNumber, titleCase } from '../../../../common/helper-functions.js'
import type { MojangApi } from '../../../../core/users/mojang.js'
import { formatTime, relativeTime } from '../../../../utility/shared-utility.js'
import { getLevelByXp } from '../skills.js'
import { formatStatNumber, getDungeonLevelWithOverflow, playerNeverPlayedDungeons } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

const DungeonClasses = ['healer', 'mage', 'berserk', 'archer', 'tank'] as const
type DungeonClass = (typeof DungeonClasses)[number]

const FloorsBaseExp = {
  m7: 300_000,
  m6: 110_000,
  m5: 70_000,
  m4: 55_000,
  m3: 35_000,
  m2: 20_000,
  m1: 15_000
}

type ClassName = 'healer' | 'berserk' | 'mage' | 'archer' | 'tank'

const ShowTimeAfter = 30 * 60 * 1000

export const catacombsView: SkyblockView = {
  name: 'cata',
  description: 'Skyblock Dungeons stats (stats, last, pb, runs, secrets, rtca subcommands)',
  example: 'sb %s cata | sb %s cata pb m7 | sb %s cata last | sb %s cata rtca m7 50',
  needsProfile: true,

  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined,
    argumentValues: string[]
  ): Promise<string> {
    assert.ok(selected)
    const member = selected.member

    switch (argumentValues[0]?.toLowerCase() ?? '') {
      case 'last':
      case 'cd': {
        return await lastRun(context, username, uuid, member)
      }
      case 'pb':
      case 'pbr': {
        return personalBest(username, argumentValues[1], member)
      }
      case 'runs':
      case 'r': {
        return runs(context, username, argumentValues[1], member)
      }
      case 'secrets':
      case 's':
      case 'sec': {
        return await secrets(context, username, uuid, member)
      }
      case 'rtca': {
        return await runsToClassAverage(context, username, argumentValues[1], argumentValues[2], member)
      }
      default: {
        return formatStats(username, member)
      }
    }
  }
}

function formatStats(username: string, member: SkyblockV2Member): string {
  const dungeons = member.dungeons
  if (!dungeons) return playerNeverPlayedDungeons(username)

  const catacombsExperience = dungeons.dungeon_types.catacombs.experience
  const catacombsLevel = getLevelByXp(catacombsExperience, { type: 'dungeoneering' }).levelWithProgress

  const playerClasses = dungeons.player_classes
  if (!playerClasses) return playerNeverPlayedDungeons(username)

  const classLevels: { className: DungeonClass; level: number }[] = DungeonClasses.map((className) => {
    const experience = playerClasses[className]?.experience ?? 0
    return {
      className: className,
      level: getLevelByXp(experience, { type: 'dungeoneering' }).levelWithProgress
    }
  })

  const classAverage = classLevels.reduce((total, entry) => total + entry.level, 0) / classLevels.length
  const classesDisplay = classLevels
    .map((entry) => `${formatNumber(entry.level, 2)}${entry.className[0].toUpperCase()}`)
    .join(', ')

  const selectedClass = titleCase(dungeons.selected_dungeon_class ?? 'none')
  const secretsFound = dungeons.secrets ?? 0

  return (
    `${username}'s Catacombs: ${formatNumber(catacombsLevel, 2)} | ` +
    `Selected Class: ${selectedClass} | ` +
    `Class Average: ${formatNumber(classAverage, 2)} | ` +
    `Secrets Found: ${formatNumber(secretsFound, 0)} | ` +
    `Classes: ${classesDisplay}`
  )
}

async function lastRun(
  context: ChatCommandContext,
  username: string,
  uuid: string,
  member: SkyblockV2Member
): Promise<string> {
  const dungeons = member.dungeons
  if (dungeons === undefined) return playerNeverPlayedDungeons(username)

  let runs = dungeons.treasures?.runs
  if (runs === undefined || runs.length === 0) return `${username} hasn't done any dungeon runs lately.`

  if (runs.length > 1) {
    runs = runs.toSorted((a, b) => b.completion_ts - a.completion_ts)
  }

  const lastRun = runs[0]
  const floorDisplayName = `${lastRun.dungeon_type === 'catacombs' ? 'F' : 'M'}${lastRun.dungeon_tier}`

  let message = ''
  let foundPlayer = false
  for (const participant of lastRun.participants) {
    if (participant.player_uuid === uuid) {
      message += await parseDisplayMessage(
        dungeons,
        context.app.mojangApi,
        participant.display_name,
        participant.player_uuid
      )
      foundPlayer = true
    }
  }
  assert.ok(foundPlayer)

  message +=
    lastRun.completion_ts + ShowTimeAfter < Date.now() ? ` was last seen ${relativeTime(lastRun.completion_ts)}` : ` is`

  message += ` playing ${floorDisplayName} `
  if (lastRun.participants.length <= 1) {
    message += `solo.`
  } else {
    message += `with `

    const participants = await Promise.all(
      lastRun.participants
        .filter((participant) => participant.player_uuid !== uuid)
        .map((participant) =>
          parseDisplayMessage(dungeons, context.app.mojangApi, participant.display_name, participant.player_uuid)
        )
    )
    message += participants.join(', ')

    message += '.'
  }

  return message
}

async function parseDisplayMessage(
  dungeonProfile: SkyblockV2Dungeons,
  mojangApi: MojangApi,
  message: string,
  uuid: string
): Promise<string> {
  const cleanMessage = message.trim().replaceAll(/§./g, '')
  const regex = /^(\w{2,16}): (\w+) \((\d+)\)$/g
  const match = regex.exec(cleanMessage)

  if (!match) return message
  const oldUsername = match[1]
  const className = match[2]
  const classLevel = match[3]

  assert.ok(/^\d+$/.test(classLevel))
  let parsedLevel = Number.parseInt(classLevel, 10)
  if (parsedLevel === 50) {
    const classes = dungeonProfile.player_classes
    const classNameKey = className.toLowerCase().trim() as 'healer' | 'mage' | 'berserk' | 'archer' | 'tank'
    assert.ok(classes !== undefined)

    const experience = classes[classNameKey]?.experience
    assert.ok(experience !== undefined)

    parsedLevel = getDungeonLevelWithOverflow(experience)
  }

  const updatedUsername = await mojangApi
    .profileByUuid(uuid)
    .then((profile) => profile.name)
    .catch(() => oldUsername)
  return `${updatedUsername} (${className} ${parsedLevel.toFixed(0)})`
}

function personalBest(username: string, givenFloor: string | undefined, member: SkyblockV2Member): string {
  const resolvedFloor = getDungeonFloor(givenFloor)
  if (resolvedFloor.error) return resolvedFloor.error

  const dungeon = member.dungeons?.dungeon_types
  if (!dungeon) return playerNeverPlayedDungeons(username)

  return formatPersonalBest(username, resolvedFloor, dungeon)
}

function formatPersonalBest(username: string, floor: DungeonFloorResolve, dungeon: SkyblockV2DungeonsTypes): string {
  if (!floor.highestFloor) {
    const selectedFloorWithEntrance = floor.floor
    const selectedFloorWithoutEntrance = floor.floor as DungeonFloors

    if (floor.masterMode) {
      return formatFloor(
        username,
        `master mode ${selectedFloorWithoutEntrance}`,
        dungeon.master_catacombs.fastest_time?.[selectedFloorWithoutEntrance],
        dungeon.master_catacombs.fastest_time_s?.[selectedFloorWithoutEntrance],
        dungeon.master_catacombs.fastest_time_s_plus?.[selectedFloorWithoutEntrance]
      )
    } else if (selectedFloorWithEntrance === '0') {
      return formatFloor(
        username,
        `entrance floor`,
        dungeon.catacombs.fastest_time?.[selectedFloorWithEntrance],
        undefined,
        undefined
      )
    } else {
      return formatFloor(
        username,
        `floor ${selectedFloorWithEntrance}`,
        dungeon.catacombs.fastest_time?.[selectedFloorWithEntrance],
        dungeon.catacombs.fastest_time_s?.[selectedFloorWithoutEntrance],
        dungeon.catacombs.fastest_time_s_plus?.[selectedFloorWithoutEntrance]
      )
    }
  }

  if (dungeon.master_catacombs.fastest_time_s_plus) {
    let selectedFloor: DungeonFloors | undefined = undefined
    for (const floorName of Object.keys(dungeon.master_catacombs.fastest_time_s_plus).toReversed()) {
      if (floorName === 'best') continue
      selectedFloor = floorName as DungeonFloors
      break
    }
    if (selectedFloor !== undefined) {
      return formatFloor(
        username,
        `master mode ${selectedFloor}`,
        dungeon.master_catacombs.fastest_time?.[selectedFloor],
        dungeon.master_catacombs.fastest_time_s?.[selectedFloor],
        dungeon.master_catacombs.fastest_time_s_plus[selectedFloor]
      )
    }
  }

  if (dungeon.catacombs.fastest_time_s_plus) {
    let selectedFloor: DungeonFloors | undefined = undefined
    for (const floorName of Object.keys(dungeon.catacombs.fastest_time_s_plus).toReversed()) {
      if (floorName === 'best') continue
      selectedFloor = floorName as DungeonFloors
      break
    }
    if (selectedFloor !== undefined) {
      return formatFloor(
        username,
        `floor ${selectedFloor}`,
        dungeon.catacombs.fastest_time?.[selectedFloor],
        dungeon.catacombs.fastest_time_s?.[selectedFloor],
        dungeon.catacombs.fastest_time_s_plus[selectedFloor]
      )
    }
  }

  if (dungeon.catacombs.fastest_time?.['0']) {
    return formatFloor(username, 'Entrance floor', dungeon.catacombs.fastest_time['0'], undefined, undefined)
  }

  return 'Player never played dungeons before?'
}

function formatFloor(
  username: string,
  floorName: string,
  completion: number | undefined,
  s: number | undefined,
  sPlus: number | undefined
): string {
  const timePrecision = 10
  let result = `${username} finished ${floorName} with `

  if (s === undefined && sPlus === undefined) {
    if (completion === undefined) return `${username} never finished ${floorName}`
    result += `a completion ${formatTime(completion, timePrecision)}`
    return result
  }

  if (s !== undefined) result += `an S ${formatTime(s, timePrecision)}`
  if (sPlus !== undefined) result += ` and an S+ ${formatTime(sPlus, timePrecision)}`

  return result
}

function getDungeonFloor(query: string | undefined): DungeonFloorResolve {
  const result: DungeonFloorResolve = { masterMode: false, floor: '0', highestFloor: false, error: undefined }
  if (query === undefined) {
    result.highestFloor = true
    return result
  }

  query = query.toLowerCase()
  if (query.includes('entrance')) {
    result.floor = '0'
    return result
  }
  const floor = Number.parseInt(query.replaceAll(/\D+/g, ''), 10)

  if (Number.isNaN(floor)) {
    result.highestFloor = true
    return result
  }

  if (query.startsWith('m')) {
    result.masterMode = true

    if (floor >= 1 && floor <= 7) {
      result.floor = floor.toString(10) as DungeonFloorsWithEntrance
      return result
    }

    result.error = 'Mastermode floor can only be between 1 and 7'
    return result
  }

  if (floor >= 0 && floor <= 7) {
    result.floor = floor.toString(10) as DungeonFloorsWithEntrance
    return result
  }
  result.error = 'Dungeon floor must be between 0 (entrance) and 7'
  return result
}

function runs(
  context: ChatCommandContext,
  username: string,
  typeArgument: string | undefined,
  member: SkyblockV2Member
): string {
  const givenType = typeArgument?.toLowerCase() ?? 'cata'

  let masterMode = false
  if (givenType == 'cata' || givenType === 'catacombs') {
    masterMode = false
  } else if (givenType === 'mm' || givenType === 'mastermode') {
    masterMode = true
  } else {
    return `${context.username}, invalid type. can be 'cata'/'mm' but not '${givenType}'`
  }

  const dungeon = member.dungeons?.dungeon_types
  if (!dungeon) {
    return playerNeverPlayedDungeons(username)
  }

  const runs = masterMode
    ? getTotalRuns(dungeon.master_catacombs.tier_completions)
    : getTotalRuns(dungeon.catacombs.tier_completions)
  if (runs.length === 0) return `${username}: ${givenType} - never done runs in this type before?`

  return `${username}: ${givenType} - ${runs.join('/')}`
}

function getTotalRuns(runs: Record<string, number | undefined> | undefined): number[] {
  if (runs === undefined) return []
  return Object.entries(runs)
    .filter(([key]) => key !== 'total')
    .map(([, value]) => value)
    .filter((value) => value !== undefined)
}

async function secrets(
  context: ChatCommandContext,
  username: string,
  uuid: string,
  member: SkyblockV2Member
): Promise<string> {
  const hypixelProfile = await context.app.hypixelApi.getPlayer(uuid)
  const dungeon = member.dungeons?.dungeon_types
  if (!dungeon) return playerNeverPlayedDungeons(username)

  const catacombRuns = dungeon.catacombs.tier_completions
  const mastermodeRuns = dungeon.master_catacombs.tier_completions

  const totalRuns = getTotalRunsCount(catacombRuns) + getTotalRunsCount(mastermodeRuns)

  const secrets = hypixelProfile.achievements.skyblockTreasureHunter as number
  const averageSecrets = secrets / totalRuns

  return `${username}'s secrets: ${secrets.toLocaleString() || 0} Total ${formatStatNumber(averageSecrets)} Average`
}

function getTotalRunsCount(runs: Record<string, number | undefined> | undefined): number {
  if (runs === undefined) return 0
  return Object.entries(runs)
    .filter(([key]) => key !== 'total')
    .map(([, value]) => value)
    .filter((value) => value !== undefined)
    .reduce((sum, c) => sum + c, 0)
}

async function runsToClassAverage(
  context: ChatCommandContext,
  username: string,
  floorArgument: string | undefined,
  averageArgument: string | undefined,
  member: SkyblockV2Member
): Promise<string> {
  const selectedFloor = floorArgument?.toLowerCase() ?? 'm7'
  const targetAverage = averageArgument ? Number.parseInt(averageArgument, 10) : 50

  if (!(selectedFloor in FloorsBaseExp)) return `Invalid floor selected: ${selectedFloor}`
  const xpPerRun = FloorsBaseExp[selectedFloor as keyof typeof FloorsBaseExp]

  if (member.dungeons?.player_classes === undefined) {
    return playerNeverPlayedDungeons(username)
  }

  const heartOfGold = member.essence?.perks?.heart_of_gold ?? 0
  const unbridledRage = member.essence?.perks?.unbridled_rage ?? 0
  const coldEfficiency = member.essence?.perks?.cold_efficiency ?? 0
  const toxophilite = member.essence?.perks?.toxophilite ?? 0
  const diamondInTheRough = member.essence?.perks?.diamond_in_the_rough ?? 0

  const GlobalBoost = 0.2 + 0.06 + 0.5 + 0.1 + 0.02
  const additionalBoost = await getAdditionalBoost(context)

  const classExpBoosts = {
    healer: (heartOfGold * 2) / 100 + 1 + GlobalBoost + additionalBoost,
    berserk: (unbridledRage * 2) / 100 + 1 + GlobalBoost + additionalBoost,
    mage: (coldEfficiency * 2) / 100 + 1 + GlobalBoost + additionalBoost,
    archer: (toxophilite * 2) / 100 + 1 + GlobalBoost + additionalBoost,
    tank: (diamondInTheRough * 2) / 100 + 1 + GlobalBoost + additionalBoost
  } satisfies Record<ClassName, number>

  let totalRuns = 0
  const runsDone = {
    healer: 0,
    berserk: 0,
    mage: 0,
    archer: 0,
    tank: 0
  } as Record<ClassName, number>
  const classesExperiences = {
    healer: 0,
    berserk: 0,
    mage: 0,
    archer: 0,
    tank: 0
  } as Record<ClassName, number>

  for (const [className, classObject] of Object.entries(member.dungeons.player_classes)) {
    classesExperiences[className as ClassName] = classObject?.experience ?? 0
  }

  let currentClassAverage = getClassAverage(classesExperiences, targetAverage)
  const classes = Object.keys(runsDone) as ClassName[]

  while (currentClassAverage < targetAverage) {
    let currentClassPlaying: undefined | ClassName = undefined
    for (const key of classes) {
      classesExperiences[key] += xpPerRun * 0.25 * classExpBoosts[key]
      if (currentClassPlaying === undefined || classesExperiences[key] < classesExperiences[currentClassPlaying]) {
        currentClassPlaying = key
      }
    }

    assert.ok(currentClassPlaying)
    classesExperiences[currentClassPlaying] += xpPerRun * 0.75 * classExpBoosts[currentClassPlaying]
    runsDone[currentClassPlaying]++

    currentClassAverage = getClassAverage(classesExperiences, targetAverage)
    totalRuns++

    if (totalRuns > 15_000) {
      return `${username} needs more than 15,000 runs to reach the average class level of ${targetAverage}.`
    }
  }

  if (totalRuns === 0) {
    return `${username} has reached c.a. ${targetAverage} already!`
  }

  return `${username} is ${totalRuns} ${selectedFloor.toUpperCase()} away from c.a. ${targetAverage} (${classes
    .filter((c) => runsDone[c] > 0)
    .map((c) => `${c} ${runsDone[c]}`)
    .join(' | ')})`
}

function getClassAverage(classData: Record<string, number>, targetAverage: number): number {
  const classesXp = Object.values(classData)
  return (
    classesXp
      .map((xp) => getDungeonLevelWithOverflow(xp))
      .map((level) => Math.min(level, targetAverage))
      .reduce((a, b) => a + b, 0) / classesXp.length
  )
}

async function getAdditionalBoost(context: ChatCommandContext): Promise<number> {
  let totalBoost = 0

  const government = await context.app.hypixelApi.getSkyblockGovernment({ raw: true })
  if (government.mayor.key === 'aura') {
    totalBoost += 0.55
  } else if (government.mayor.key === 'derpy') {
    totalBoost += 0.5
  }

  return totalBoost
}

interface DungeonFloorResolve {
  masterMode: boolean
  floor: DungeonFloorsWithEntrance
  highestFloor: boolean
  error: string | undefined
}
