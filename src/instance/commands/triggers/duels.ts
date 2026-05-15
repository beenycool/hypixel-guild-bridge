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
  | 'quake'
  | 'bedwars'

const LongModeDuelTypes: ReadonlySet<DuelType> = new Set(['bridge', 'boxing', 'megawalls', 'nodebuff', 'parkour'])

interface GamemodeStats {
  wins: number
  winstreak: number
  bestWinstreak: number
  // eslint-disable-next-line @typescript-eslint/naming-convention
  WLRatio: number
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
    'quake',
    'bedwars'
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
    quake: 'Quake',
    bedwars: 'Bed Wars'
  }

  constructor() {
    super({
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
    const isFirstArgumentDuelType = firstArgument && Duels.ValidDuelTypes.has(firstArgument as DuelType)

    const duelType: DuelType | undefined = isFirstArgumentDuelType ? (firstArgument as DuelType) : undefined
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
    if (stats === undefined) return `${givenUsername} has never played Duels.`

    if (!duelType) {
      // Overall stats
      const wins = stats.wins
      const winstreak = stats.winstreak
      const bestWinstreak = stats.bestWinstreak
      const wlRatio = stats.WLRatio
      const division = calculateDuelsDivision(wins, 'overall')

      return (
        `[Duels] [${this.formatDivision(division)}] ${givenUsername} ` +
        `W: ${shortenNumber(wins)} | CWS: ${winstreak} | BWS: ${bestWinstreak} | WLR: ${wlRatio.toFixed(2)}`
      )
    }

    // Bridge sub-mode stats
    if (duelType === 'bridge' && bridgeSubMode !== undefined) {
      const bridgeData = stats.bridge as unknown as Record<string, unknown> | undefined

      if (!bridgeData || typeof bridgeData !== 'object') {
        return `${givenUsername} has no Bridge stats.`
      }

      const subModeRaw = bridgeData?.[bridgeSubMode]
      if (!subModeRaw || typeof subModeRaw !== 'object') {
        return `${givenUsername} has no ${BridgeSubModeDisplayNames.get(bridgeSubMode)} stats.`
      }

      const subModeData = subModeRaw as GamemodeStats
      const wins = subModeData.wins
      const winstreak = subModeData.winstreak
      const bestWinstreak = subModeData.bestWinstreak
      const wlRatio = subModeData.WLRatio ?? 0
      const division = calculateDuelsDivision(wins, 'long')

      return (
        `[${BridgeSubModeDisplayNames.get(bridgeSubMode)}] [${this.formatDivision(division)}] ${givenUsername} ` +
        `W: ${shortenNumber(wins)} | CWS: ${winstreak} | BWS: ${bestWinstreak} | WLR: ${wlRatio.toFixed(2)}`
      )
    }

    // Mode-specific stats
    const modeData = (stats as unknown as Record<string, unknown>)[duelType]
    if (!modeData || typeof modeData !== 'object') {
      return `${givenUsername} has no ${Duels.DuelDisplayNames[duelType]} Duels stats.`
    }

    const firstKey = Object.keys(modeData)[0]
    const duelData = firstKey ? (modeData as Record<string, unknown>)[firstKey] : modeData
    const dataObject = (typeof duelData === 'object' && duelData !== null ? duelData : modeData) as GamemodeStats

    const wins = dataObject.wins
    const winstreak = dataObject.winstreak
    const bestWinstreak = dataObject.bestWinstreak
    const wlRatio = dataObject.WLRatio ?? 0
    const divisionMode: DuelsDivisionMode = LongModeDuelTypes.has(duelType) ? 'long' : 'short'
    const division = calculateDuelsDivision(wins, divisionMode)

    return (
      `[${Duels.DuelDisplayNames[duelType]}] [${this.formatDivision(division)}] ${givenUsername} ` +
      `W: ${shortenNumber(wins)} | CWS: ${winstreak} | BWS: ${bestWinstreak} | WLR: ${wlRatio.toFixed(2)}`
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
