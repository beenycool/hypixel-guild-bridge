import { isAxiosError } from 'axios'
import { httpClient } from '../../../common/http.js'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { getUuidIfExists, usernameNotExists } from '../common/utility.js'

type Period = 'weekly' | 'monthly' | 'yearly' | 'custom'

const GAME_ALIASES: Record<string, string> = {
  bw: 'Bedwars',
  bedwars: 'Bedwars',
  bwars: 'Bedwars',
  sw: 'SkyWars',
  skywars: 'SkyWars',
  duels: 'Duels',
  duel: 'Duels',
  pit: 'Pit',
  sb: 'SkyBlock',
  skyblock: 'SkyBlock',
  arcade: 'Arcade',
  arc: 'Arcade',
  arena: 'Arena',
  battleground: 'Battleground',
  warlords: 'Battleground',
  wl: 'Battleground',
  buildbattle: 'BuildBattle',
  build: 'BuildBattle',
  bb: 'BuildBattle',
  gingerbread: 'GingerBread',
  ginger: 'GingerBread',
  tr: 'GingerBread',
  turboracing: 'GingerBread',
  housing: 'Housing',
  hungergames: 'HungerGames',
  hg: 'HungerGames',
  sg: 'HungerGames',
  legacy: 'Legacy',
  lobby: 'MainLobby',
  mainlobby: 'MainLobby',
  mcgo: 'MCGO',
  cz: 'MCGO',
  copsandrobbers: 'MCGO',
  murdermystery: 'MurderMystery',
  mm: 'MurderMystery',
  paintball: 'Paintball',
  pb: 'Paintball',
  quake: 'Quake',
  quakecraft: 'Quake',
  skyclash: 'SkyClash',
  sc: 'SkyClash',
  smash: 'SuperSmash',
  supersmash: 'SuperSmash',
  ss: 'SuperSmash',
  speeduhc: 'SpeedUHC',
  suhc: 'SpeedUHC',
  tntgames: 'TNTGames',
  tnt: 'TNTGames',
  truecombat: 'TrueCombat',
  tc: 'TrueCombat',
  uhc: 'UHC',
  vampirez: 'VampireZ',
  vz: 'VampireZ',
  walls: 'Walls',
  walls3: 'Walls3',
  mw: 'Walls3',
  megawalls: 'Walls3',
  woolgames: 'WoolGames',
  wool: 'WoolGames',
  blitz: 'HungerGames'
}

const GAME_SHORT: Record<string, string> = {
  Bedwars: 'BW',
  SkyWars: 'SW',
  Arcade: 'Arc',
  Battleground: 'WL',
  MCGO: 'CZ',
  Quake: 'Quake',
  Walls: 'Walls',
  Walls3: 'MW',
  SpeedUHC: 'SUHC',
  TNTGames: 'TNT',
  VampireZ: 'VZ',
  Paintball: 'PB',
  SuperSmash: 'SS',
  GingerBread: 'TR',
  HungerGames: 'SG',
  Duels: 'Duels',
  BuildBattle: 'BB',
  MurderMystery: 'MM',
  SkyClash: 'SC',
  TrueCombat: 'TC',
  Arena: 'Arena',
  UHC: 'UHC',
  SkyBlock: 'SB',
  Pit: 'Pit',
  WoolGames: 'WG',
  Housing: 'House',
  Legacy: 'Legacy',
  MainLobby: 'Lobby'
}

const STAT_SHORT: Record<string, string> = {
  wins: 'W',
  kills: 'K',
  deaths: 'D',
  final_kills: 'FK',
  final_deaths: 'FD',
  beds_broken: 'BB',
  beds_lost: 'BL',
  games_played: 'GP',
  winstreak: 'WS',
  experience: 'XP',
  score: 'Score',
  assists: 'A',
  coins: 'Coins'
}

const GAME_SUFFIX = /_(?:bedwars|skywars|duels|walls3|speeduhc|tntgames|paintball|quake|arena)$/

const NOISE_KEYS = /^(coins?|resources_collected|items?_purchased|resource_purchased|coin_pickups|slumber)/i

function fmt(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

function ratio(a: number, b: number): string | undefined {
  if (b <= 0) return undefined
  return (a / b).toFixed(2)
}

function shortGame(name: string): string {
  return GAME_SHORT[name] ?? name.slice(0, 6)
}

function shortStat(name: string): string {
  const stripped = name.replace(GAME_SUFFIX, '')
  return STAT_SHORT[stripped] ?? stripped
}

function isNoise(key: string): boolean {
  const stripped = key.replace(GAME_SUFFIX, '')
  return NOISE_KEYS.test(stripped)
}

function extractDuelSubmodes(stats: Record<string, unknown>): { name: string; wins: number; losses: number }[] {
  const submodes: { name: string; wins: number; losses: number }[] = []
  for (const [key, value] of Object.entries(stats)) {
    const match = /^(.+)_duel_wins$/.exec(key)
    if (!match) continue
    const mode = match[1]
    const wins = typeof value === 'number' ? value : 0
    if (wins === 0) continue
    const lossesKey = `${mode}_duel_losses`
    const deathsKey = `${mode}_duel_deaths`
    const losses =
      typeof stats[lossesKey] === 'number'
        ? stats[lossesKey]
        : typeof stats[deathsKey] === 'number'
          ? stats[deathsKey]
          : 0
    submodes.push({ name: mode, wins, losses })
  }
  submodes.sort((a, b) => b.wins - a.wins)
  return submodes.slice(0, 5)
}

// ---- Bedwars submodes ----

const BEDWARS_MODE_SUFFIXES = ['1', '2', '3', '4', '4v4', 'castle']
const BEDWARS_MODE_LABELS: Record<string, string> = {
  '1': 'Solo',
  '2': 'Dubs',
  '3': '3s',
  '4': '4s',
  '4v4': '4v4',
  castle: 'Castle'
}

function extractBedwarsSubmodes(stats: Record<string, unknown>): { name: string; wins: number; losses: number; kills: number; deaths: number; finalKills: number; finalDeaths: number; gamesPlayed: number }[] {
  const result: { name: string; wins: number; losses: number; kills: number; deaths: number; finalKills: number; finalDeaths: number; gamesPlayed: number }[] = []
  for (const suffix of BEDWARS_MODE_SUFFIXES) {
    const wins = (stats[`wins_bedwars_${suffix}`] as number) ?? 0
    if (wins === 0) continue
    const losses = (stats[`losses_bedwars_${suffix}`] as number) ?? 0
    const kills = (stats[`kills_bedwars_${suffix}`] as number) ?? 0
    const deaths = (stats[`deaths_bedwars_${suffix}`] as number) ?? 0
    const finalKills = (stats[`final_kills_bedwars_${suffix}`] as number) ?? 0
    const finalDeaths = (stats[`final_deaths_bedwars_${suffix}`] as number) ?? 0
    const gamesPlayed = (stats[`games_played_bedwars_${suffix}`] as number) ?? 0
    result.push({ name: BEDWARS_MODE_LABELS[suffix], wins, losses, kills, deaths, finalKills, finalDeaths, gamesPlayed })
  }
  result.sort((a, b) => b.gamesPlayed - a.gamesPlayed)
  return result.slice(0, 3)
}

function formatBedwarsSubmode(s: { name: string; wins: number; losses: number; kills: number; deaths: number; finalKills: number; finalDeaths: number; gamesPlayed: number }): string {
  const parts: string[] = []
  const wlr = ratio(s.wins, s.losses)
  parts.push(wlr ? `${s.wins}W/${s.losses}L(${wlr})` : `${s.wins}W/${s.losses}L`)
  if (s.finalKills || s.finalDeaths) {
    const fkdr = ratio(s.finalKills, s.finalDeaths)
    parts.push(fkdr ? `${s.finalKills}FK/${s.finalDeaths}FD(${fkdr})` : `${s.finalKills}FK/${s.finalDeaths}FD`)
  }
  if (s.kills || s.deaths) {
    const kdr = ratio(s.kills, s.deaths)
    parts.push(kdr ? `${s.kills}K/${s.deaths}D(${kdr})` : `${s.kills}K/${s.deaths}D`)
  }
  if (s.gamesPlayed) parts.push(`${s.gamesPlayed}GP`)
  return `${s.name}:${parts.join(' ')}`
}

function formatBedwars(stats: Record<string, unknown>): string {
  const w = (stats.wins_bedwars as number) ?? 0
  const k = (stats.kills_bedwars as number) ?? 0
  const fk = (stats.final_kills_bedwars as number) ?? 0
  const fd = (stats.final_deaths_bedwars as number) ?? 0
  const xp = (stats.Experience as number) ?? 0
  const gp = (stats.games_played_bedwars as number) ?? 0
  const bb = (stats.beds_broken_bedwars as number) ?? 0
  const bl = (stats.beds_lost_bedwars as number) ?? 0
  const ws = (stats.winstreak as number) ?? 0

  const parts: string[] = []
  if (w !== 0) parts.push(`${fmt(w)}W`)
  if (k !== 0) parts.push(`${fmt(k)}K`)
  if (fk !== 0) parts.push(`${fmt(fk)}FK`)
  if (fd !== 0) parts.push(`${fmt(fd)}FD`)
  const fkdr = ratio(fk, fd)
  if (fkdr) parts.push(`(${fkdr} FKDR)`)
  if (xp !== 0) parts.push(`${fmt(xp)}XP`)
  if (gp !== 0) parts.push(`${gp}GP`)
  if (bb !== 0) parts.push(`${fmt(bb)}BB`)
  if (bl !== 0) parts.push(`${fmt(bl)}BL`)
  if (ws !== 0) parts.push(`${fmt(ws)}WS`)

  const submodes = extractBedwarsSubmodes(stats)
  if (submodes.length > 0) {
    const subParts = submodes.map(formatBedwarsSubmode)
    parts.push(subParts.join(', '))
  }
  return `BW: ${parts.join(', ')}`
}

// ---- SkyWars submodes ----

const SKYWARS_MODE_IDS = ['solo_normal', 'team_normal', 'mega', 'ranked', 'labs', 'solo_insane', 'team_insane', 'mega_doubles']
const SKYWARS_MODE_LABELS: Record<string, string> = {
  solo_normal: 'Solo',
  team_normal: 'Team',
  mega: 'Mega',
  ranked: 'Ranked',
  labs: 'Labs',
  solo_insane: 'SoloI',
  team_insane: 'TeamI',
  mega_doubles: 'MegaD'
}

function extractSkywarsSubmodes(stats: Record<string, unknown>): { name: string; wins: number; losses: number; kills: number; deaths: number; gamesPlayed: number }[] {
  const result: { name: string; wins: number; losses: number; kills: number; deaths: number; gamesPlayed: number }[] = []
  for (const id of SKYWARS_MODE_IDS) {
    const wins = (stats[`wins_${id}`] as number) ?? 0
    if (wins === 0) continue
    const losses = (stats[`losses_${id}`] as number) ?? 0
    const kills = (stats[`kills_${id}`] as number) ?? 0
    const deaths = (stats[`deaths_${id}`] as number) ?? 0
    const gamesPlayed = (stats[`games_played_${id}`] as number) ?? (stats[`games_played_skywars_${id}`] as number) ?? 0
    result.push({ name: SKYWARS_MODE_LABELS[id], wins, losses, kills, deaths, gamesPlayed })
  }
  result.sort((a, b) => b.gamesPlayed - a.gamesPlayed)
  return result.slice(0, 3)
}

function formatSkywarsSubmode(s: { name: string; wins: number; losses: number; kills: number; deaths: number; gamesPlayed: number }): string {
  const parts: string[] = []
  const kdr = ratio(s.kills, s.deaths)
  parts.push(kdr ? `${s.kills}K/${s.deaths}D(${kdr})` : `${s.kills}K/${s.deaths}D`)
  const wlr = ratio(s.wins, s.losses)
  parts.push(wlr ? `${s.wins}W/${s.losses}L(${wlr})` : `${s.wins}W/${s.losses}L`)
  if (s.gamesPlayed) parts.push(`${s.gamesPlayed}GP`)
  return `${s.name}:${parts.join(' ')}`
}

function formatSkywars(stats: Record<string, unknown>): string {
  const k = (stats.kills as number) ?? 0
  const d = (stats.deaths as number) ?? 0
  const w = (stats.wins as number) ?? 0
  const l = (stats.losses as number) ?? 0
  const gp = (stats.games_played_skywars as number) ?? 0
  const xp = (stats.skywars_experience as number) ?? 0
  const souls = (stats.souls as number) ?? 0

  const parts: string[] = []
  if (k !== 0) parts.push(`${fmt(k)}K`)
  if (d !== 0) parts.push(`${fmt(d)}D`)
  const kd = ratio(k, d)
  if (kd) parts.push(`(${kd} KD)`)
  if (w !== 0) parts.push(`${fmt(w)}W`)
  if (l !== 0) parts.push(`${fmt(l)}L`)
  const wlr = ratio(w, l)
  if (wlr) parts.push(`(${wlr} WLR)`)
  if (gp !== 0) parts.push(`${gp}GP`)
  if (xp !== 0) parts.push(`${fmt(xp)}XP`)
  if (souls !== 0) parts.push(`${fmt(souls)}Souls`)

  const submodes = extractSkywarsSubmodes(stats)
  if (submodes.length > 0) {
    const subParts = submodes.map(formatSkywarsSubmode)
    parts.push(subParts.join(', '))
  }
  return `SW: ${parts.join(', ')}`
}

function formatDuels(stats: Record<string, unknown>): string {
  const w = (stats.wins as number) ?? 0
  const l = (stats.losses as number) ?? 0

  const parts: string[] = []
  if (w !== 0) parts.push(`${fmt(w)}W`)
  if (l !== 0) parts.push(`${fmt(l)}L`)
  const wlr = ratio(w, l)
  if (wlr) parts.push(`(${wlr} WLR)`)

  const submodes = extractDuelSubmodes(stats)
  if (submodes.length > 0) {
    const subParts = submodes.map((s) => {
      const swlr = ratio(s.wins, s.losses)
      return swlr ? `${s.name}:${s.wins}W/${s.losses}L(${swlr})` : `${s.name}:${s.wins}W/${s.losses}L`
    })
    parts.push(subParts.join(', '))
  }
  return `Duels: ${parts.join(', ')}`
}

function formatSingleGame(gameKey: string, stats: Record<string, unknown>): string | undefined {
  const prefix = shortGame(gameKey)
  const nums: Record<string, number> = {}
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v !== 'number' || v === 0) continue
    if (isNoise(k)) continue
    nums[k] = v
  }
  if (Object.keys(nums).length === 0) return undefined
  const top = Object.entries(nums)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 10)
    .map(([k, v]) => `${shortStat(k)}${v > 0 ? '+' : ''}${v}`)
    .join(', ')
  return `${prefix}: ${top}`
}

function formatAllGames(delta: Record<string, unknown>): string | undefined {
  const parts: string[] = []
  const stats = delta.stats as Record<string, unknown> | undefined

  if (stats) {
    const games: { text: string; mag: number }[] = []

    for (const [game, change] of Object.entries(stats)) {
      if (typeof change !== 'object' || change === null) continue
      const c = change as Record<string, unknown>

      if ('new' in c && c.new === null && 'old' in c) {
        games.push({ text: `${shortGame(game)}: stopped`, mag: 999 })
        continue
      }
      if ('old' in c && c.old === null && 'new' in c) {
        games.push({ text: `${shortGame(game)}: started`, mag: 999 })
        continue
      }

      const nums: Record<string, number> = {}
      for (const [k, v] of Object.entries(c)) {
        if (typeof v !== 'number' || v === 0) continue
        if (isNoise(k)) continue
        nums[k] = v
      }
      if (Object.keys(nums).length === 0) continue

      const mag = Object.values(nums).reduce((a, b) => a + Math.abs(b), 0)
      const statsString = Object.entries(nums)
        .slice(0, 3)
        .map(([k, v]) => `${shortStat(k)}${v > 0 ? '+' : ''}${v}`)
        .join(', ')
      games.push({ text: `${shortGame(game)}: ${statsString}`, mag })
    }

    games.sort((a, b) => b.mag - a.mag)
    if (games.length > 0) {
      parts.push(
        games
          .slice(0, 2)
          .map((g) => g.text)
          .join(' | ')
      )
    }
  }

  for (const [key, value] of Object.entries(delta)) {
    if (key === 'stats') continue
    if (typeof value !== 'number' || value === 0) continue
    if (key.startsWith('last') || key.endsWith('Reward') || key.endsWith('GenerateTime') || key === 'rewardHighScore')
      continue
    parts.push(`${key}: ${value > 0 ? '+' : ''}${value}`)
  }

  return parts.length > 0 ? parts.join(' | ') : undefined
}

function resolveGameKey(input: string): string | undefined {
  const lower = input.toLowerCase()
  if (GAME_ALIASES[lower]) return GAME_ALIASES[lower]
  for (const [key] of Object.entries(GAME_SHORT)) {
    if (key.toLowerCase() === lower) return key
  }
  return undefined
}

class SessionCommand extends ChatCommandHandler {
  private readonly period: Period

  constructor(trigger: string, period: Period, description: string) {
    super({ triggers: [trigger], description, example: `${trigger} %s` })
    this.period = period
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const apiKey = context.app.urchinApiKey
    if (!apiKey) {
      return context.app.i18n.t(($) => $['commands.sessions.no-key'])
    }

    const isCustom = this.period === 'custom'
    let duration: string | undefined

    let effectiveArgs = context.args
    if (isCustom) {
      if (context.args.length === 0) {
        return 'Usage: !session <duration> [game] [username]. Example: !session 48h Bedwars PlayerName'
      }
      duration = context.args[0].toLowerCase()
      if (!/^\d+[hdw]$/.test(duration)) {
        return 'Invalid duration. Use format like 48h, 3d, or 2w.'
      }
      effectiveArgs = context.args.slice(1)
    }

    let gameFilter: string | undefined
    let givenUsername: string

    const first = effectiveArgs[0]
    const second = effectiveArgs[1]

    if (first) {
      const resolved = resolveGameKey(first)
      if (resolved) {
        gameFilter = resolved
        givenUsername = second ?? context.username
      } else {
        givenUsername = first
      }
    } else {
      givenUsername = context.username
    }

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid === undefined) return usernameNotExists(context, givenUsername)

    try {
      const response = await httpClient.get<{
        uuid: string
        displayname?: string | null
        from: number
        from_readable: string
        delta: Record<string, unknown>
      }>(`https://api.urchin.gg/v3/player/sessions/${isCustom ? 'custom' : this.period}`, {
        headers: { 'X-API-Key': apiKey },
        params: { player: uuid, ...(isCustom && duration ? { duration } : {}) }
      })

      const delta = response.data.delta
      const stats = delta.stats as Record<string, unknown> | undefined

      let summary: string | undefined

      if (gameFilter) {
        const gameStats = stats?.[gameFilter] as Record<string, unknown> | undefined
        if (!gameStats) {
          return context.app.i18n.t(($) => $['commands.sessions.game-not-found'], {
            game: gameFilter,
            period: isCustom ? (duration ?? 'custom') : this.period,
            username: givenUsername
          })
        }

        switch (gameFilter) {
          case 'Bedwars': {
            summary = formatBedwars(gameStats)

            break
          }
          case 'SkyWars': {
            summary = formatSkywars(gameStats)

            break
          }
          case 'Duels': {
            summary = formatDuels(gameStats)

            break
          }
          default: {
            summary = formatSingleGame(gameFilter, gameStats)
          }
        }
      } else {
        summary = formatAllGames(delta)
      }

      if (!summary) {
        return context.app.i18n.t(($) => $['commands.sessions.no-changes'], {
          username: givenUsername,
          period: isCustom ? (duration ?? 'custom') : this.period
        })
      }

      return context.app.i18n.t(($) => $['commands.sessions.result'], {
        username: givenUsername,
        period: isCustom ? (duration ?? 'custom') : this.period,
        summary
      })
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        if (error.response?.status === 404) {
          return context.app.i18n.t(($) => $['commands.sessions.not-found'], { username: givenUsername })
        }
        if (error.response?.status === 401 || error.response?.status === 403) {
          return context.app.i18n.t(($) => $['commands.sessions.invalid-key'])
        }
      }
      context.logger.error(error)

      try {
        const healthResp = await httpClient.get('https://api.urchin.gg/health', { timeout: 3000 })
        if (healthResp.status !== 200 || healthResp.data?.status !== 'healthy') {
          return context.app.i18n.t(($) => $['commands.sessions.api-degraded'])
        }
        return context.app.i18n.t(($) => $['commands.sessions.api-ok-but-error'], { username: givenUsername })
      } catch {
        return context.app.i18n.t(($) => $['commands.sessions.api-down'])
      }
    }
  }
}

export default class SessionCommands {
  public resolveCommands(): ChatCommandHandler[] {
    return [
      new SessionCommand('weekly', 'weekly', 'Show weekly stat changes (or !weekly <game>)'),
      new SessionCommand('monthly', 'monthly', 'Show monthly stat changes (or !monthly <game>)'),
      new SessionCommand('yearly', 'yearly', 'Show yearly stat changes (or !yearly <game>)'),
      new SessionCommand('session', 'custom', 'Show stat changes over custom duration. Example: !session 48h Bedwars')
    ]
  }
}
