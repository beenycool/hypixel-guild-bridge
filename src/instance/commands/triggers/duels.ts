import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { calculateDuelsDivision, type DuelsDivisionMode, shortenNumber } from '../common/utility'

import type { BridgeSubMode } from './duels-bridge-modes.js'
import { BridgeSubModeAliases, BridgeSubModeDisplayNames, ValidBridgeSubModes } from './duels-bridge-modes.js'

type DuelType =
  | 'blitz'
  | 'uhc'
  | 'parkour'
  | 'boxing'
  | 'bowspleef'
  | 'spleef'
  | 'arena'
  | 'megawalls'
  | 'op'
  | 'sumo'
  | 'classic'
  | 'combo'
  | 'bridge'
  | 'nodebuff'
  | 'bow'
  | 'skywars'
  | 'bedwars_two_one'
  | 'bedwars_rush'

const LongModeDuelTypes: ReadonlySet<DuelType> = new Set(['bridge', 'boxing', 'megawalls', 'nodebuff', 'parkour'])

const DuelTypeAliases = new Map<string, DuelType>([
  ['bw', 'bedwars_two_one'],
  ['bwr', 'bedwars_rush'],
  ['bedwars', 'bedwars_two_one'],
  ['bedwarsrush', 'bedwars_rush']
])

interface GamemodeStats {
  wins: number
  losses: number
  winstreak: number
  bestWinstreak: number
  // eslint-disable-next-line @typescript-eslint/naming-convention
  WLRatio: number
}

interface RawPlayerResponse {
  player?: {
    stats?: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Hypixel API field name
      Duels?: Record<string, unknown>
    }
  }
}

/* eslint-disable @typescript-eslint/naming-convention -- keys are Bridge sub-mode wire IDs */
const BridgeRawPrefixes: Record<BridgeSubMode, string> = {
  solo: 'bridge_duel',
  doubles: 'bridge_doubles',
  threes: 'bridge_threes',
  fours: 'bridge_four',
  '2v2v2v2': 'bridge_2v2v2v2',
  '3v3v3v3': 'bridge_3v3v3v3'
}
/* eslint-enable @typescript-eslint/naming-convention */

const BridgeOverallPrefixes = [
  'bridge_duel',
  'bridge_doubles',
  'bridge_threes',
  'bridge_four',
  'bridge_2v2v2v2',
  'bridge_3v3v3v3',
  'capture_threes'
] as const

/* eslint-disable @typescript-eslint/naming-convention -- keys are Hypixel Duel type wire IDs */
const BedwarsRawPrefixes = {
  bedwars_two_one: 'bedwars_two_one_duels',
  bedwars_rush: 'bedwars_two_one_duels_rush'
} as const
/* eslint-enable @typescript-eslint/naming-convention */

function readRawNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  return typeof value === 'number' ? value : 0
}

function divideLikeHypixel(wins: number, losses: number): number {
  if (losses === 0) return wins
  return Number((wins / losses).toFixed(2))
}

export function formatBridgeWins(value: number): string {
  if (value < 1000) return value.toString(10)

  const shortened = Math.floor(value / 100) / 10
  return Number.isInteger(shortened) ? `${shortened.toFixed(0)}k` : `${shortened.toFixed(1)}k`
}

export function getBridgeStatsFromRawDuels(
  rawDuels: Record<string, unknown>,
  bridgeSubMode?: BridgeSubMode
): GamemodeStats {
  if (bridgeSubMode !== undefined) {
    const prefix = BridgeRawPrefixes[bridgeSubMode]
    const wins = readRawNumber(rawDuels, `${prefix}_wins`)
    const losses = readRawNumber(rawDuels, `${prefix}_losses`)

    return {
      wins,
      losses,
      winstreak: readRawNumber(rawDuels, `current_winstreak_mode_${prefix}`),
      bestWinstreak: readRawNumber(rawDuels, `best_winstreak_mode_${prefix}`),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      WLRatio: divideLikeHypixel(wins, losses)
    }
  }

  const wins = BridgeOverallPrefixes.reduce((total, prefix) => total + readRawNumber(rawDuels, `${prefix}_wins`), 0)
  const losses = BridgeOverallPrefixes.reduce((total, prefix) => total + readRawNumber(rawDuels, `${prefix}_losses`), 0)

  return {
    wins,
    losses,
    winstreak: readRawNumber(rawDuels, 'current_bridge_winstreak'),
    bestWinstreak: readRawNumber(rawDuels, 'best_bridge_winstreak'),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    WLRatio: divideLikeHypixel(wins, losses)
  }
}

type BedwarsMode = 'bedwars_two_one' | 'bedwars_rush'

function getBedwarsStatsFromRawDuels(rawDuels: Record<string, unknown>, mode: BedwarsMode): GamemodeStats {
  const prefix = BedwarsRawPrefixes[mode]
  const wins = readRawNumber(rawDuels, `${prefix}_wins`)
  const lossesKey = `${prefix}_losses`
  let losses: number

  if (lossesKey in rawDuels) {
    losses = readRawNumber(rawDuels, lossesKey)
  } else {
    const roundsPlayed = readRawNumber(rawDuels, `${prefix}_rounds_played`)
    losses = Math.max(0, roundsPlayed - wins)
  }

  return {
    wins,
    losses,
    winstreak: readRawNumber(rawDuels, `current_winstreak_mode_${prefix}`),
    bestWinstreak: readRawNumber(rawDuels, `best_winstreak_mode_${prefix}`),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    WLRatio: divideLikeHypixel(wins, losses)
  }
}

function getBedwarsCombinedWins(rawDuels: Record<string, unknown>): number {
  return (
    readRawNumber(rawDuels, 'bedwars_two_one_duels_wins') + readRawNumber(rawDuels, 'bedwars_two_one_duels_rush_wins')
  )
}

const SPLEEF_RAW_PREFIX = 'spleef_duel'

function getSpleefStatsFromRawDuels(rawDuels: Record<string, unknown>): GamemodeStats {
  const wins = readRawNumber(rawDuels, `${SPLEEF_RAW_PREFIX}_wins`)
  const losses = readRawNumber(rawDuels, `${SPLEEF_RAW_PREFIX}_losses`)

  return {
    wins,
    losses,
    winstreak: readRawNumber(rawDuels, `current_winstreak_mode_${SPLEEF_RAW_PREFIX}`),
    bestWinstreak: readRawNumber(rawDuels, `best_winstreak_mode_${SPLEEF_RAW_PREFIX}`),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    WLRatio: divideLikeHypixel(wins, losses)
  }
}

export default class Duels extends HypixelPlayerCommand {
  private static readonly ValidDuelTypes: ReadonlySet<DuelType> = new Set([
    'blitz',
    'uhc',
    'parkour',
    'boxing',
    'bowspleef',
    'spleef',
    'arena',
    'megawalls',
    'op',
    'sumo',
    'classic',
    'combo',
    'bridge',
    'nodebuff',
    'bow',
    'skywars',

    'bedwars_two_one',
    'bedwars_rush'
  ])

  private static readonly DuelDisplayNames: Record<DuelType, string> = {
    blitz: 'Blitz',
    uhc: 'UHC',
    parkour: 'Parkour',
    boxing: 'Boxing',
    bowspleef: 'Bow Spleef',
    spleef: 'Spleef',
    arena: 'Arena',
    megawalls: 'MegaWalls',
    op: 'OP',
    sumo: 'Sumo',
    classic: 'Classic',
    combo: 'Combo',
    bridge: 'Bridge',
    nodebuff: 'NoDebuff',
    bow: 'Bow',
    skywars: 'SkyWars',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    bedwars_two_one: 'BW 1v1',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    bedwars_rush: 'BW Rush'
  }

  constructor() {
    super({
      category: 'Minigames',
      triggers: ['duels', 'duel', 'd'],
      description: "Returns a player's Duels stats with optional mode filter",
      example: `duels [mode] %s`
    })
  }

  protected override resolveUsername(context: ChatCommandContext): string {
    return this.parseArgs(context).username
  }

  private parseArgs(context: ChatCommandContext): {
    duelType: DuelType | undefined
    bridgeSubMode: BridgeSubMode | undefined
    username: string
  } {
    const commandArguments = context.args

    const firstArgument = commandArguments[0]?.toLowerCase()
    const resolvedFirstArgument = DuelTypeAliases.get(firstArgument) ?? firstArgument
    const isFirstArgumentDuelType = resolvedFirstArgument && Duels.ValidDuelTypes.has(resolvedFirstArgument as DuelType)

    const duelType: DuelType | undefined = isFirstArgumentDuelType ? (resolvedFirstArgument as DuelType) : undefined
    let givenUsername = isFirstArgumentDuelType
      ? (commandArguments[1] ?? context.username)
      : (commandArguments[0] ?? context.username)

    if (isFirstArgumentDuelType && firstArgument === 'bridge') {
      const secondArgument = commandArguments[1]?.toLowerCase()
      const resolvedSubMode = secondArgument ? BridgeSubModeAliases.get(secondArgument) : undefined
      const isValidSubMode = secondArgument && ValidBridgeSubModes.has(secondArgument as BridgeSubMode)
      if (resolvedSubMode || isValidSubMode) {
        givenUsername = commandArguments[2] ?? context.username
      }
    }

    let bridgeSubMode: BridgeSubMode | undefined
    if (isFirstArgumentDuelType && firstArgument === 'bridge') {
      const secondArgument = commandArguments[1]?.toLowerCase()
      const resolvedSubMode = secondArgument ? BridgeSubModeAliases.get(secondArgument) : undefined
      const isValidSubMode = secondArgument && ValidBridgeSubModes.has(secondArgument as BridgeSubMode)
      if (resolvedSubMode || isValidSubMode) {
        bridgeSubMode = resolvedSubMode ?? (secondArgument as BridgeSubMode)
      }
    }

    return { duelType, bridgeSubMode, username: givenUsername }
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const { duelType, bridgeSubMode } = this.parseArgs(context)
    const stats = player.stats?.duels
    if (stats === undefined) return `${givenUsername} has never played Duels.` + this.formatPingSuffix()

    let rawBridgeStats: Record<string, unknown> | undefined
    if (duelType === 'bridge') {
      const rawResponse = (await context.app.hypixelApi
        .getPlayer(player.uuid, { raw: true })
        .catch(() => undefined)) as RawPlayerResponse | undefined
      rawBridgeStats = rawResponse?.player?.stats?.Duels
    }

    if (!duelType) {
      const wins = stats.wins
      const losses = stats.losses
      const winstreak = stats.winstreak
      const bestWinstreak = stats.bestWinstreak
      const wlRatio = stats.WLRatio
      const division = calculateDuelsDivision(wins, 'overall')

      return (
        `[Duels] [${this.formatDivision(division)}] ${givenUsername} ` +
        `W: ${shortenNumber(wins)} | L: ${shortenNumber(losses)} | CWS: ${winstreak} | BWS: ${bestWinstreak} | WLR: ${wlRatio.toFixed(2)}` +
        this.formatPingSuffix()
      )
    }

    if (duelType === 'bedwars_two_one' || duelType === 'bedwars_rush') {
      const rawResponse = (await context.app.hypixelApi
        .getPlayer(player.uuid, { raw: true })
        .catch(() => undefined)) as RawPlayerResponse | undefined
      const rawDuels = rawResponse?.player?.stats?.Duels

      if (rawDuels === undefined) {
        return `${givenUsername} has no Bed Wars Duels stats.` + this.formatPingSuffix()
      }

      const combinedWins = getBedwarsCombinedWins(rawDuels)
      const division = calculateDuelsDivision(combinedWins, 'short')
      const data = getBedwarsStatsFromRawDuels(rawDuels, duelType)

      return (
        `[${Duels.DuelDisplayNames[duelType]}] [${this.formatDivision(division)}] ${givenUsername} ` +
        `W: ${shortenNumber(data.wins)} | L: ${shortenNumber(data.losses)} | CWS: ${data.winstreak} | BWS: ${data.bestWinstreak} | WLR: ${data.WLRatio.toFixed(2)}` +
        this.formatPingSuffix()
      )
    }

    if (duelType === 'spleef') {
      const rawResponse = (await context.app.hypixelApi
        .getPlayer(player.uuid, { raw: true })
        .catch(() => undefined)) as RawPlayerResponse | undefined
      const rawDuels = rawResponse?.player?.stats?.Duels

      if (rawDuels === undefined) {
        return `${givenUsername} has no Spleef Duels stats.` + this.formatPingSuffix()
      }

      const data = getSpleefStatsFromRawDuels(rawDuels)
      const division = calculateDuelsDivision(data.wins, 'short')

      return (
        `[Spleef] [${this.formatDivision(division)}] ${givenUsername} ` +
        `W: ${shortenNumber(data.wins)} | L: ${shortenNumber(data.losses)} | CWS: ${data.winstreak} | BWS: ${data.bestWinstreak} | WLR: ${data.WLRatio.toFixed(2)}` +
        this.formatPingSuffix()
      )
    }

    if (duelType === 'bridge' && bridgeSubMode !== undefined) {
      if (rawBridgeStats !== undefined) {
        const bridgeData = getBridgeStatsFromRawDuels(rawBridgeStats, bridgeSubMode)
        const division = calculateDuelsDivision(bridgeData.wins, 'long')

        return (
          `[${BridgeSubModeDisplayNames.get(bridgeSubMode)}] [${this.formatDivision(division)}] ${givenUsername} ` +
          `W: ${formatBridgeWins(bridgeData.wins)} | L: ${shortenNumber(bridgeData.losses)} | CWS: ${bridgeData.winstreak} | BWS: ${bridgeData.bestWinstreak} | WLR: ${bridgeData.WLRatio.toFixed(2)}` +
          this.formatPingSuffix()
        )
      }

      const bridgeData = stats.bridge as unknown as Record<string, unknown> | undefined

      if (!bridgeData || typeof bridgeData !== 'object') {
        return `${givenUsername} has no Bridge stats.` + this.formatPingSuffix()
      }

      const subModeRaw = bridgeData[bridgeSubMode]
      if (!subModeRaw || typeof subModeRaw !== 'object') {
        return (
          `${givenUsername} has no ${BridgeSubModeDisplayNames.get(bridgeSubMode)} stats.` + this.formatPingSuffix()
        )
      }

      const subModeData = subModeRaw as GamemodeStats
      const wins = subModeData.wins
      const losses = subModeData.losses
      const winstreak = subModeData.winstreak
      const bestWinstreak = subModeData.bestWinstreak
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const wlRatio = subModeData.WLRatio ?? 0
      const division = calculateDuelsDivision(wins, 'long')

      return (
        `[${BridgeSubModeDisplayNames.get(bridgeSubMode)}] [${this.formatDivision(division)}] ${givenUsername} ` +
        `W: ${shortenNumber(wins)} | L: ${shortenNumber(losses)} | CWS: ${winstreak} | BWS: ${bestWinstreak} | WLR: ${wlRatio.toFixed(2)}` +
        this.formatPingSuffix()
      )
    }

    if (duelType === 'bridge') {
      const bridgeData =
        rawBridgeStats === undefined
          ? (stats.bridge as GamemodeStats | undefined)
          : getBridgeStatsFromRawDuels(rawBridgeStats)
      if (bridgeData === undefined) {
        return `${givenUsername} has no Bridge stats.` + this.formatPingSuffix()
      }

      const division = calculateDuelsDivision(bridgeData.wins, 'long')

      return (
        `[Bridge] [${this.formatDivision(division)}] ${givenUsername} ` +
        `W: ${formatBridgeWins(bridgeData.wins)} | L: ${shortenNumber(bridgeData.losses)} | CWS: ${bridgeData.winstreak} | BWS: ${bridgeData.bestWinstreak} | WLR: ${bridgeData.WLRatio.toFixed(2)}` +
        this.formatPingSuffix()
      )
    }

    const modeData = (stats as unknown as Record<string, unknown>)[duelType]
    if (!modeData || typeof modeData !== 'object') {
      return `${givenUsername} has no ${Duels.DuelDisplayNames[duelType]} Duels stats.` + this.formatPingSuffix()
    }

    const firstKey = Object.keys(modeData)[0]
    const duelData = firstKey ? (modeData as Record<string, unknown>)[firstKey] : modeData
    const dataObject = (typeof duelData === 'object' && duelData !== null ? duelData : modeData) as GamemodeStats

    const wins = dataObject.wins
    const losses = dataObject.losses
    const winstreak = dataObject.winstreak
    const bestWinstreak = dataObject.bestWinstreak
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const wlRatio = dataObject.WLRatio ?? 0
    const divisionMode: DuelsDivisionMode = LongModeDuelTypes.has(duelType) ? 'long' : 'short'
    const division = calculateDuelsDivision(wins, divisionMode)

    return (
      `[${Duels.DuelDisplayNames[duelType]}] [${this.formatDivision(division)}] ${givenUsername} ` +
      `W: ${shortenNumber(wins)} | L: ${shortenNumber(losses)} | CWS: ${winstreak} | BWS: ${bestWinstreak} | WLR: ${wlRatio.toFixed(2)}` +
      this.formatPingSuffix()
    )
  }

  private formatDivision(division: string): string {
    const topTiers = ['celestial', 'divine', 'ascended']
    const lowerDivision = division.toLowerCase()
    for (const tier of topTiers) {
      if (lowerDivision.startsWith(tier)) {
        return division.toUpperCase()
      }
    }
    return division
  }
}
