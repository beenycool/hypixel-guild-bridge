import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import {
  calculateDuelsDivision,
  type DuelsDivisionMode,
  getUuidIfExists,
  playerNeverPlayedHypixel,
  shortenNumber,
  usernameNotExists
} from '../common/utility'

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

// Bridge, Boxing, MegaWalls, NoDebuff, and Parkour use halved win thresholds
// compared to short modes — see: https://hypixel.fandom.com/wiki/Duels
const LongModeDuelTypes: readonly DuelType[] = ['bridge', 'boxing', 'megawalls', 'nodebuff', 'parkour']

export default class Duels extends ChatCommandHandler {
  private static readonly ValidDuelTypes: readonly DuelType[] = [
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
  ]

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

  async handler(context: ChatCommandContext): Promise<string> {
    const commandArguments = context.args

    // Parse duel type and username from arguments
    const firstArgument = commandArguments[0]?.toLowerCase()
    const isFirstArgumentDuelType = firstArgument && Duels.ValidDuelTypes.includes(firstArgument as DuelType)

    const duelType: DuelType | undefined = isFirstArgumentDuelType ? (firstArgument as DuelType) : undefined
    const givenUsername = isFirstArgumentDuelType
      ? (commandArguments[1] ?? context.username)
      : (commandArguments[0] ?? context.username)

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    const player = await context.app.hypixelApi.getPlayer(uuid, {}).catch(() => undefined)
    if (player == undefined) return playerNeverPlayedHypixel(context, givenUsername)

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

    // Mode-specific stats
    const modeData = (stats as unknown as Record<string, unknown>)[duelType]
    if (!modeData || typeof modeData !== 'object') {
      return `${givenUsername} has no ${Duels.DuelDisplayNames[duelType]} Duels stats.`
    }

    const firstKey = Object.keys(modeData)[0]
    const duelData = firstKey ? (modeData as Record<string, unknown>)[firstKey] : modeData
    const dataObject = (typeof duelData === 'object' && duelData !== null ? duelData : modeData) as Record<
      string,
      unknown
    >

    const wins = dataObject.wins as number
    const winstreak = dataObject.winstreak as number
    const bestWinstreak = dataObject.bestWinstreak as number
    const wlRatio = dataObject.WLRatio as number
    const divisionMode: DuelsDivisionMode = LongModeDuelTypes.includes(duelType) ? 'long' : 'short'
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
