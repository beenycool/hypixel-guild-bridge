import { isAxiosError } from 'axios'
import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { httpClient } from '../../../common/http.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import {
  capitalize,
  fetchAuroraWinstreak,
  formatStatNumber,
  getUuidIfExists,
  shortenNumber,
  usernameNotExists
} from '../common/utility'

type BedwarsMode = 'overall' | 'solo' | 'doubles' | 'threes' | 'fours' | '4v4'
type Period = 'daily' | 'weekly' | 'monthly'

interface BedwarsSubmodeStats {
  name: string
  wins: number
  losses: number
  kills: number
  deaths: number
  finalKills: number
  finalDeaths: number
  bedsBroken: number
  bedsLost: number
  gamesPlayed: number
}

interface BordicSessionResponse {
  success: boolean
  uuid: string
  start: number
  end: number
  delta: Record<string, unknown>
}

/* eslint-disable @typescript-eslint/naming-convention -- keys are Bedwars mode wire IDs from the Hypixel API */
const BORDIC_MODE_LABELS: Record<string, string> = {
  eight_one: 'Solo',
  eight_two: 'Dubs',
  four_three: '3s',
  four_four: '4s',
  four_four_: '4v4',
  castle: 'Castle',
  eight_one_rush: 'Solo Rush',
  eight_two_rush: 'Dubs Rush',
  four_three_rush: '3s Rush',
  four_four_rush: '4s Rush',
  eight_one_ultimate: 'Solo Ult',
  eight_two_ultimate: 'Dubs Ult',
  four_three_ultimate: '3s Ult',
  four_four_ultimate: '4s Ult',
  eight_one_armed: 'Solo Armed',
  eight_two_armed: 'Dubs Armed',
  four_three_armed: '3s Armed',
  four_four_armed: '4s Armed',
  eight_one_lucky: 'Solo Lucky',
  eight_two_lucky: 'Dubs Lucky',
  four_three_lucky: '3s Lucky',
  four_four_lucky: '4s Lucky',
  eight_one_voidless: 'Solo VL',
  eight_two_voidless: 'Dubs VL',
  four_three_voidless: '3s VL',
  four_four_voidless: '4s VL',
  eight_one_swap: 'Solo Swap',
  eight_two_swap: 'Dubs Swap',
  four_three_swap: '3s Swap',
  four_four_swap: '4s Swap',
  eight_one_oneblock: 'Solo OB',
  eight_two_oneblock: 'Dubs OB',
  four_three_oneblock: '3s OB',
  four_four_oneblock: '4s OB',
  eight_two_underworld: 'Dubs UW',
  four_three_underworld: '3s UW',
  four_four_underworld: '4s UW'
}
/* eslint-enable @typescript-eslint/naming-convention */

const SUBMODE_STAT_FIELD: Record<string, keyof Omit<BedwarsSubmodeStats, 'name'>> = {
  wins: 'wins',
  losses: 'losses',
  kills: 'kills',
  deaths: 'deaths',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case key from the API
  final_kills: 'finalKills',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case key from the API
  final_deaths: 'finalDeaths',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case key from the API
  beds_broken: 'bedsBroken',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case key from the API
  beds_lost: 'bedsLost',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case key from the API
  games_played: 'gamesPlayed'
}

const SUBMODE_STAT_NAMES = Object.keys(SUBMODE_STAT_FIELD).toSorted()

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

const SUBMODE_PREFIX_PATTERN = Object.keys(BORDIC_MODE_LABELS)
  .toSorted((a, b) => b.length - a.length)
  .map((mode) => escapeRegex(mode))
  .join('|')

const SUBMODE_KEY = new RegExp(
  `^(${SUBMODE_PREFIX_PATTERN})_(${SUBMODE_STAT_NAMES.map((stat) => escapeRegex(stat)).join('|')})_bedwars$`
)

function fmt(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

function ratio(a: number, b: number): string | undefined {
  if (b <= 0) return undefined
  return (a / b).toFixed(2)
}

function readNumber(stats: Record<string, unknown>, key: string): number | undefined {
  const value = stats[key]
  return typeof value === 'number' ? value : undefined
}

function extractBedwarsSubmodeDeltas(delta: Record<string, unknown>): BedwarsSubmodeStats[] {
  const byPrefix = new Map<string, BedwarsSubmodeStats>()
  for (const [key, value] of Object.entries(delta)) {
    if (typeof value !== 'number' || value === 0) continue
    const match = SUBMODE_KEY.exec(key)
    if (!match) continue
    const field = SUBMODE_STAT_FIELD[match[2]]
    let stats = byPrefix.get(match[1])
    if (stats === undefined) {
      stats = {
        name: BORDIC_MODE_LABELS[match[1]] ?? match[1],
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        finalKills: 0,
        finalDeaths: 0,
        bedsBroken: 0,
        bedsLost: 0,
        gamesPlayed: 0
      }
      byPrefix.set(match[1], stats)
    }
    stats[field] = value
  }

  const result = [...byPrefix.values()]
  result.sort((a, b) => b.gamesPlayed - a.gamesPlayed)
  return result.slice(0, 3)
}

function formatBedwarsSubmodeDelta(s: BedwarsSubmodeStats): string {
  const parts: string[] = []
  const wlr = ratio(s.wins, s.losses)
  parts.push(wlr ? `${fmt(s.wins)}W/${fmt(s.losses)}L(${wlr})` : `${fmt(s.wins)}W/${fmt(s.losses)}L`)
  if (s.finalKills !== 0 || s.finalDeaths !== 0) {
    const fkdr = ratio(s.finalKills, s.finalDeaths)
    parts.push(
      fkdr
        ? `${fmt(s.finalKills)}FK/${fmt(s.finalDeaths)}FD(${fkdr})`
        : `${fmt(s.finalKills)}FK/${fmt(s.finalDeaths)}FD`
    )
  }
  if (s.kills !== 0 || s.deaths !== 0) {
    const kdr = ratio(s.kills, s.deaths)
    parts.push(kdr ? `${fmt(s.kills)}K/${fmt(s.deaths)}D(${kdr})` : `${fmt(s.kills)}K/${fmt(s.deaths)}D`)
  }
  if (s.bedsBroken !== 0 || s.bedsLost !== 0) parts.push(`${fmt(s.bedsBroken)}BB/${fmt(s.bedsLost)}BL`)
  if (s.gamesPlayed !== 0) parts.push(`${fmt(s.gamesPlayed)}GP`)
  return `${s.name}:${parts.join(' ')}`
}

function formatBedwarsDelta(delta: Record<string, unknown>): string | undefined {
  const w = readNumber(delta, 'wins_bedwars') ?? 0
  const l = readNumber(delta, 'losses_bedwars') ?? 0
  const k = readNumber(delta, 'kills_bedwars') ?? 0
  const d = readNumber(delta, 'deaths_bedwars') ?? 0
  const fk = readNumber(delta, 'final_kills_bedwars') ?? 0
  const fd = readNumber(delta, 'final_deaths_bedwars') ?? 0
  const xp = readNumber(delta, 'Experience') ?? 0
  const gp = readNumber(delta, 'games_played_bedwars') ?? 0
  const bb = readNumber(delta, 'beds_broken_bedwars') ?? 0
  const bl = readNumber(delta, 'beds_lost_bedwars') ?? 0
  const ws = readNumber(delta, 'winstreak') ?? 0

  const parts: string[] = []
  if (w !== 0) parts.push(`${fmt(w)}W`)
  if (l !== 0) parts.push(`${fmt(l)}L`)
  if (k !== 0) parts.push(`${fmt(k)}K`)
  if (d !== 0) parts.push(`${fmt(d)}D`)
  if (fk !== 0) parts.push(`${fmt(fk)}FK`)
  if (fd !== 0) parts.push(`${fmt(fd)}FD`)
  const fkdr = ratio(fk, fd)
  if (fkdr) parts.push(`(${fkdr} FKDR)`)
  if (xp !== 0) parts.push(`${fmt(xp)}XP`)
  if (gp !== 0) parts.push(`${fmt(gp)}GP`)
  if (bb !== 0) parts.push(`${fmt(bb)}BB`)
  if (bl !== 0) parts.push(`${fmt(bl)}BL`)
  if (ws !== 0) parts.push(`${fmt(ws)}WS`)

  const submodes = extractBedwarsSubmodeDeltas(delta)
  if (submodes.length > 0) {
    parts.push(submodes.map((s) => formatBedwarsSubmodeDelta(s)).join(', '))
  }

  return parts.length > 0 ? parts.join(', ') : undefined
}

export default class Bedwars extends HypixelPlayerCommand {
  private static readonly ValidModes: readonly BedwarsMode[] = ['overall', 'solo', 'doubles', 'threes', 'fours', '4v4']
  private static readonly ValidPeriods: readonly Period[] = ['daily', 'weekly', 'monthly']
  private static readonly BordicSessionsBaseUrl = 'https://api.bordic.xyz/v4/sessions'
  private static readonly BordicSessionsUserAgent = 'Hypixel-Guild-Discord-Bridge-BedwarsSessions/1.0.0'

  constructor() {
    super({
      category: 'Minigames',
      triggers: ['bedwars', 'bw', 'bws'],
      description: "Returns a player's Bed Wars stats with optional mode or period filter",
      example: `bw [mode|daily|weekly|monthly] %s`
    })
  }

  protected override resolveUsername(context: ChatCommandContext): string {
    return this.parseArgs(context).username
  }

  override async handler(context: ChatCommandContext): Promise<string> {
    const { period } = this.parseArgs(context)
    if (period !== undefined) {
      return await this.handlePeriod(context, period)
    }
    return super.handler(context)
  }

  private parseArgs(context: ChatCommandContext): { mode: BedwarsMode; period: Period | undefined; username: string } {
    const firstArgument = context.args[0]?.toLowerCase()
    const isFirstArgumentMode = Bedwars.ValidModes.includes(firstArgument as BedwarsMode)
    const isFirstArgumentPeriod = Bedwars.ValidPeriods.includes(firstArgument as Period)
    return {
      mode: isFirstArgumentMode ? (firstArgument as BedwarsMode) : 'overall',
      period: isFirstArgumentPeriod ? (firstArgument as Period) : undefined,
      username:
        isFirstArgumentMode || isFirstArgumentPeriod
          ? (context.args[1] ?? context.username)
          : (context.args[0] ?? context.username)
    }
  }

  private async handlePeriod(context: ChatCommandContext, period: Period): Promise<string> {
    const apiKey = context.app.auroraApiKey
    if (apiKey === undefined) {
      return context.app.i18n.t(($) => $['commands.bw-sessions.no-key'])
    }

    const givenUsername = this.parseArgs(context).username
    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid === undefined) return usernameNotExists(context, givenUsername)

    try {
      const url = `${Bedwars.BordicSessionsBaseUrl}/${period}?key=${encodeURIComponent(apiKey)}&uuid=${uuid}`
      const response = await httpClient.get<BordicSessionResponse>(url, {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the protocol
        headers: { 'User-Agent': Bedwars.BordicSessionsUserAgent }
      })

      if (!response.data.success) {
        return context.app.i18n.t(($) => $['commands.bw-sessions.error'], { username: givenUsername, period })
      }

      const summary = formatBedwarsDelta(response.data.delta)
      if (summary === undefined) {
        return context.app.i18n.t(($) => $['commands.bw-sessions.no-changes'], { username: givenUsername, period })
      }

      return context.app.i18n.t(($) => $['commands.bw-sessions.result'], { username: givenUsername, period, summary })
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          return context.app.i18n.t(($) => $['commands.bw-sessions.invalid-key'])
        }
        if (error.response?.status === 404) {
          return context.app.i18n.t(($) => $['commands.bw-sessions.not-found'], { username: givenUsername })
        }
        if (error.response?.status === 429) {
          return context.app.i18n.t(($) => $['commands.bw-sessions.rate-limited'])
        }
      }
      context.logger.error(error)
      return context.app.i18n.t(($) => $['commands.bw-sessions.error'], { username: givenUsername, period })
    }
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const { mode } = this.parseArgs(context)

    const stats = player.stats?.bedwars
    if (stats == undefined) return `${givenUsername} has never played Bed Wars before?` + this.formatPingSuffix()

    const modeStats = mode === 'overall' ? stats : (stats as unknown as Record<string, unknown>)[mode]
    if (modeStats === undefined) {
      return `${givenUsername} has no ${capitalize(mode)} Bed Wars stats.` + this.formatPingSuffix()
    }

    const level = stats.level
    const finalKills = this.getStat(modeStats, 'finalKills') ?? 0
    const finalKDRatio = this.getStat(modeStats, 'finalKDRatio') ?? 0
    const wins = this.getStat(modeStats, 'wins') ?? 0
    const losses = this.getStat(modeStats, 'losses') ?? 0
    const wlRatio = this.getStat(modeStats, 'WLRatio') ?? 0
    const bedsBroken = this.getStat(modeStats, 'beds', 'broken') ?? 0
    const blRatio = this.getStat(modeStats, 'beds', 'BLRatio') ?? 0
    let winstreak = this.getStat(modeStats, 'winstreak')
    let wsPrefix = ''
    if (mode === 'overall' && (winstreak === undefined || winstreak === 0)) {
      const lastUuid = this.lastUuid
      if (lastUuid !== undefined) {
        const auraData = await fetchAuroraWinstreak(lastUuid, context.app.auroraApiKey ?? '')
        if (auraData !== undefined) {
          winstreak = auraData.winstreak
          wsPrefix = '~'
        }
      }
    }
    const wsDisplay =
      mode === 'overall'
        ? winstreak === undefined
          ? '-'
          : `${wsPrefix}${winstreak}`
        : winstreak === undefined || winstreak === 0
          ? '-'
          : `${winstreak}`

    const modePrefix = mode === 'overall' ? '' : `${capitalize(mode)} `

    return (
      `[${level.toFixed(0)}✫] ${givenUsername} ${modePrefix}` +
      `FK: ${shortenNumber(finalKills)} FKDR: ${formatStatNumber(finalKDRatio)} ` +
      `W: ${shortenNumber(wins)} L: ${shortenNumber(losses)} WLR: ${formatStatNumber(wlRatio)} ` +
      `BB: ${shortenNumber(bedsBroken)} BLR: ${formatStatNumber(blRatio)} ` +
      `WS: ${wsDisplay}` +
      this.formatPingSuffix()
    )
  }

  private getStat(object: unknown, ...keys: string[]): number | undefined {
    let current: unknown = object
    for (const key of keys) {
      if (current === null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[key]
    }
    return typeof current === 'number' ? current : undefined
  }
}
