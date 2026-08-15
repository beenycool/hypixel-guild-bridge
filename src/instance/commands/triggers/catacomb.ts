import assert from 'node:assert'

import type {
  DungeonFloors,
  DungeonFloorsWithEntrance,
  SkyblockV2Dungeons,
  SkyblockV2DungeonsTypes,
  SkyblockV2Member
} from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { formatNumber, titleCase } from '../../../common/helper-functions.js'
import type { MojangApi } from '../../../core/users/mojang'
import { formatTime, relativeTime } from '../../../utility/shared-utility'
import { getLevelByXp } from '../common/skills'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import {
  formatStatNumber,
  getDungeonLevelWithOverflow,
  getSelectedSkyblockProfileRaw,
  getUuidIfExists,
  playerNeverPlayedDungeons,
  playerNeverPlayedSkyblock,
  usernameNotExists
} from '../common/utility'

const DungeonClasses = ['healer', 'mage', 'berserk', 'archer', 'tank'] as const
type DungeonClass = (typeof DungeonClasses)[number]

type DungeonView = 'stats' | 'last' | 'pb' | 'runs' | 'secrets' | 'rtca'

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

const ViewTriggers: Partial<Record<string, DungeonView>> = {
  stats: 'stats',
  last: 'last',
  cd: 'last',
  currdungeon: 'last',
  currentdungeon: 'last',
  pb: 'pb',
  pbr: 'pb',
  personalbest: 'pb',
  runs: 'runs',
  r: 'runs',
  secrets: 'secrets',
  s: 'secrets',
  sec: 'secrets',
  rtca: 'rtca'
}

export function resolveDungeonView(commandTrigger: string, argumentValues: string[]): DungeonView {
  const directView = ViewTriggers[commandTrigger.toLowerCase()]
  if (directView !== undefined) return directView

  if (argumentValues.length === 0) return 'stats'
  const subcommand = argumentValues[0].toLowerCase()
  const view = ViewTriggers[subcommand]
  if (view !== undefined) return view
  return 'stats'
}

export default class Catacomb extends SkyblockPlayerCommand {
  private static readonly ShowTimeAfter = 30 * 60 * 1000

  constructor() {
    super({
      triggers: [
        'catacombs',
        'cata',
        'dungeons',
        'cd',
        'currdungeon',
        'currentdungeon',
        'pb',
        'pbr',
        'personalbest',
        'runs',
        'r',
        'secrets',
        's',
        'sec',
        'rtca'
      ],
      description: 'Skyblock Dungeons stats (stats, last, pb, runs, secrets, rtca subcommands)',
      example: `catacombs %s | cata pb %s m7 | cata last %s | cata rtca %s m7 50`
    })
  }

  override async handler(context: ChatCommandContext): Promise<string> {
    const view = this.resolveView(context)
    switch (view) {
      case 'last': {
        return this.lastRun(context)
      }
      case 'pb': {
        return this.personalBest(context)
      }
      case 'runs': {
        return this.runs(context)
      }
      case 'secrets': {
        return this.secrets(context)
      }
      case 'rtca': {
        return this.runsToClassAverage(context)
      }
      default: {
        return this.stats(context)
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    return this.formatStats(context, username, selectedProfile)
  }

  private resolveView(context: ChatCommandContext): DungeonView {
    const trigger = context.message.message.split(' ')[0].slice(context.commandPrefix.length).toLowerCase()
    return resolveDungeonView(trigger, context.args)
  }

  private async resolvePlayer(
    context: ChatCommandContext,
    username: string
  ): Promise<{ username: string; profile: SkyblockV2Member } | string> {
    const uuid = await getUuidIfExists(context.app.mojangApi, username)
    if (uuid == undefined) return usernameNotExists(context, username)

    const selectedProfile = await getSelectedSkyblockProfileRaw(context.app.hypixelApi, uuid)
    if (!selectedProfile) return playerNeverPlayedSkyblock(context, username)

    return { username, profile: selectedProfile }
  }

  private async stats(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const resolved = await this.resolvePlayer(context, givenUsername)
    if (typeof resolved === 'string') return resolved
    return this.formatStats(context, resolved.username, resolved.profile)
  }

  private formatStats(context: ChatCommandContext, username: string, profile: SkyblockV2Member): string {
    const dungeons = profile.dungeons
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

  private async lastRun(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const resolved = await this.resolvePlayer(context, givenUsername)
    if (typeof resolved === 'string') return resolved
    const { username, profile } = resolved

    const uuid = await getUuidIfExists(context.app.mojangApi, username)
    if (uuid == undefined) return usernameNotExists(context, username)

    const dungeons = profile.dungeons
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
        message += await this.parseDisplayMessage(
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
      lastRun.completion_ts + Catacomb.ShowTimeAfter < Date.now()
        ? ` was last seen ${relativeTime(lastRun.completion_ts)}`
        : ` is`

    message += ` playing ${floorDisplayName} `
    if (lastRun.participants.length <= 1) {
      message += `solo.`
    } else {
      message += `with `

      const participants = await Promise.all(
        lastRun.participants
          .filter((participant) => participant.player_uuid !== uuid)
          .map((participant) =>
            this.parseDisplayMessage(dungeons, context.app.mojangApi, participant.display_name, participant.player_uuid)
          )
      )
      message += participants.join(', ')

      message += '.'
    }

    return message
  }

  private async parseDisplayMessage(
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

  private async personalBest(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const resolved = await this.resolvePlayer(context, givenUsername)
    if (typeof resolved === 'string') return resolved
    const { username, profile } = resolved

    const givenFloor = context.args[1]
    const resolvedFloor = this.getDungeonFloor(givenFloor)
    if (resolvedFloor.error) return resolvedFloor.error

    const dungeon = profile.dungeons?.dungeon_types
    if (!dungeon) return playerNeverPlayedDungeons(username)

    return this.formatPersonalBest(username, resolvedFloor, dungeon)
  }

  private formatPersonalBest(username: string, floor: DungeonFloorResolve, dungeon: SkyblockV2DungeonsTypes): string {
    if (!floor.highestFloor) {
      const selectedFloorWithEntrance = floor.floor
      const selectedFloorWithoutEntrance = floor.floor as DungeonFloors

      if (floor.masterMode) {
        return this.formatFloor(
          username,
          `master mode ${selectedFloorWithoutEntrance}`,
          dungeon.master_catacombs.fastest_time?.[selectedFloorWithoutEntrance],
          dungeon.master_catacombs.fastest_time_s?.[selectedFloorWithoutEntrance],
          dungeon.master_catacombs.fastest_time_s_plus?.[selectedFloorWithoutEntrance]
        )
      } else if (selectedFloorWithEntrance === '0') {
        return this.formatFloor(
          username,
          `entrance floor`,
          dungeon.catacombs.fastest_time?.[selectedFloorWithEntrance],
          undefined,
          undefined
        )
      } else {
        return this.formatFloor(
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
        return this.formatFloor(
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
        return this.formatFloor(
          username,
          `floor ${selectedFloor}`,
          dungeon.catacombs.fastest_time?.[selectedFloor],
          dungeon.catacombs.fastest_time_s?.[selectedFloor],
          dungeon.catacombs.fastest_time_s_plus[selectedFloor]
        )
      }
    }

    if (dungeon.catacombs.fastest_time?.['0']) {
      return this.formatFloor(username, 'Entrance floor', dungeon.catacombs.fastest_time['0'], undefined, undefined)
    }

    return 'Player never played dungeons before?'
  }

  private formatFloor(
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

  private getDungeonFloor(query: string | undefined): DungeonFloorResolve {
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

  private async runs(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[1] ?? context.username
    const resolved = await this.resolvePlayer(context, givenUsername)
    if (typeof resolved === 'string') return resolved
    const { username, profile } = resolved

    const givenType = context.args[0]?.toLowerCase() ?? 'cata'

    let masterMode = false
    if (givenType == 'cata' || givenType === 'catacombs') {
      masterMode = false
    } else if (givenType === 'mm' || givenType === 'mastermode') {
      masterMode = true
    } else {
      return `${context.username}, invalid type. can be 'cata'/'mm' but not '${givenType}'`
    }

    const dungeon = profile.dungeons?.dungeon_types
    if (!dungeon) {
      return playerNeverPlayedDungeons(username)
    }

    const runs = masterMode
      ? this.getTotalRuns(dungeon.master_catacombs.tier_completions)
      : this.getTotalRuns(dungeon.catacombs.tier_completions)
    if (runs.length === 0) return `${username}: ${givenType} - never done runs in this type before?`

    return `${username}: ${givenType} - ${runs.join('/')}`
  }

  private getTotalRuns(runs: Record<string, number | undefined> | undefined): number[] {
    if (runs === undefined) return []
    return Object.entries(runs)
      .filter(([key]) => key !== 'total')
      .map(([, value]) => value)
      .filter((value) => value !== undefined)
  }

  private async secrets(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const resolved = await this.resolvePlayer(context, givenUsername)
    if (typeof resolved === 'string') return resolved
    const { username, profile } = resolved

    const uuid = await getUuidIfExists(context.app.mojangApi, username)
    if (uuid == undefined) return usernameNotExists(context, username)

    const hypixelProfile = await context.app.hypixelApi.getPlayer(uuid)
    const dungeon = profile.dungeons?.dungeon_types
    if (!dungeon) return playerNeverPlayedDungeons(username)

    const catacombRuns = dungeon.catacombs.tier_completions
    const mastermodeRuns = dungeon.master_catacombs.tier_completions

    const totalRuns = this.getTotalRunsCount(catacombRuns) + this.getTotalRunsCount(mastermodeRuns)

    const secrets = hypixelProfile.achievements.skyblockTreasureHunter as number
    const averageSecrets = secrets / totalRuns

    return `${username}'s secrets: ${secrets.toLocaleString() || 0} Total ${formatStatNumber(averageSecrets)} Average`
  }

  private getTotalRunsCount(runs: Record<string, number | undefined> | undefined): number {
    if (runs === undefined) return 0
    return Object.entries(runs)
      .filter(([key]) => key !== 'total')
      .map(([, value]) => value)
      .filter((value) => value !== undefined)
      .reduce((sum, c) => sum + c, 0)
  }

  private async runsToClassAverage(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const resolved = await this.resolvePlayer(context, givenUsername)
    if (typeof resolved === 'string') return resolved
    const { username, profile } = resolved

    const selectedFloor = context.args[1]?.toLowerCase() ?? 'm7'
    const targetAverage = context.args[2] ? Number.parseInt(context.args[2], 10) : 50

    if (!(selectedFloor in FloorsBaseExp)) return `Invalid floor selected: ${selectedFloor}`
    const xpPerRun = FloorsBaseExp[selectedFloor as keyof typeof FloorsBaseExp]

    if (profile.dungeons?.player_classes === undefined) {
      return playerNeverPlayedDungeons(username)
    }

    const heartOfGold = profile.essence?.perks?.heart_of_gold ?? 0
    const unbridledRage = profile.essence?.perks?.unbridled_rage ?? 0
    const coldEfficiency = profile.essence?.perks?.cold_efficiency ?? 0
    const toxophilite = profile.essence?.perks?.toxophilite ?? 0
    const diamondInTheRough = profile.essence?.perks?.diamond_in_the_rough ?? 0

    const GlobalBoost = 0.2 + 0.06 + 0.5 + 0.1 + 0.02
    const additionalBoost = await this.getAdditionalBoost(context)

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

    for (const [className, classObject] of Object.entries(profile.dungeons.player_classes)) {
      classesExperiences[className as ClassName] = classObject?.experience ?? 0
    }

    let currentClassAverage = this.getClassAverage(classesExperiences, targetAverage)
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

      currentClassAverage = this.getClassAverage(classesExperiences, targetAverage)
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

  private getClassAverage(classData: Record<string, number>, targetAverage: number): number {
    const classesXp = Object.values(classData)
    return (
      classesXp
        .map((xp) => getDungeonLevelWithOverflow(xp))
        .map((level) => Math.min(level, targetAverage))
        .reduce((a, b) => a + b, 0) / classesXp.length
    )
  }

  private async getAdditionalBoost(context: ChatCommandContext): Promise<number> {
    let totalBoost = 0

    const government = await context.app.hypixelApi.getSkyblockGovernment({ raw: true })
    if (government.mayor.key === 'aura') {
      totalBoost += 0.55
    } else if (government.mayor.key === 'derpy') {
      totalBoost += 0.5
    }

    return totalBoost
  }
}

interface DungeonFloorResolve {
  masterMode: boolean
  floor: DungeonFloorsWithEntrance
  highestFloor: boolean
  error: string | undefined
}
