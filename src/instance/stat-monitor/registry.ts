/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-unnecessary-condition */

import type { Player } from 'hypixel-api-reborn'

export interface StatDefinition {
  label: string
  decimals: number
  extract: (player: Player) => number | undefined
}

export type GameRegistry = Record<string, StatDefinition>

function fixedStat(path: string[], label: string, decimals = 2): StatDefinition {
  return {
    label,
    decimals,
    extract: (player: Player) => {
      let current: unknown = player.stats
      for (const key of path) {
        if (current === null || typeof current !== 'object') return
        current = (current as Record<string, unknown>)[key]
      }
      return typeof current === 'number' ? current : undefined
    }
  }
}

function wlrFromWinsLosses(gamePath: string, label: string): StatDefinition {
  return {
    label,
    decimals: 2,
    extract: (player: Player) => {
      const stats = player.stats as Record<string, unknown> | undefined
      const game = stats?.[gamePath] as Record<string, unknown> | undefined
      if (!game) return
      const wins = game.wins as number | undefined
      const losses = game.losses as number | undefined
      if (wins === undefined || losses === undefined) return
      if (losses === 0) return wins
      return wins / losses
    }
  }
}

const gameRegistries: Record<string, GameRegistry> = {
  bedwars: {
    FKDR: fixedStat(['bedwars', 'finalKDRatio'], 'FKDR'),
    stars: fixedStat(['bedwars', 'level'], 'Stars', 0),
    WLR: wlrFromWinsLosses('bedwars', 'WLR'),
    wins: fixedStat(['bedwars', 'wins'], 'Wins', 0),
    finals: fixedStat(['bedwars', 'finalKills'], 'Final Kills', 0),
    beds: fixedStat(['bedwars', 'beds', 'broken'], 'Beds Broken', 0)
  },
  duels: {
    WLR: wlrFromWinsLosses('duels', 'WLR'),
    wins: fixedStat(['duels', 'wins'], 'Wins', 0),
    winstreak: fixedStat(['duels', 'winstreak'], 'Winstreak', 0)
  },
  skywars: {
    KDR: fixedStat(['skywars', 'KDRatio'], 'KDR'),
    stars: fixedStat(['skywars', 'level'], 'Stars', 0),
    wins: fixedStat(['skywars', 'wins'], 'Wins', 0)
  },
  murdermystery: {
    kills: fixedStat(['murdermystery', 'kills'], 'Kills', 0),
    wins: fixedStat(['murdermystery', 'wins'], 'Wins', 0)
  },
  buildbattle: {
    score: fixedStat(['buildbattle', 'score'], 'Score', 0),
    wins: fixedStat(['buildbattle', 'wins', 'solo'], 'Solo Wins', 0)
  },
  megawalls: {
    finalKDR: fixedStat(['megawalls', 'finalKDRatio'], 'Final KDR'),
    wins: fixedStat(['megawalls', 'wins'], 'Wins', 0)
  },
  pit: {
    kills: fixedStat(['pit', 'kills'], 'Kills', 0)
  },
  blitz: {
    kills: fixedStat(['blitzsg', 'kills'], 'Kills', 0),
    wins: fixedStat(['blitzsg', 'wins'], 'Wins', 0)
  },
  uhc: {
    KDR: fixedStat(['uhc', 'KDRatio'], 'KDR'),
    wins: fixedStat(['uhc', 'wins'], 'Wins', 0)
  },
  paintball: {
    kills: fixedStat(['paintball', 'kills'], 'Kills', 0),
    KDR: fixedStat(['paintball', 'KDRatio'], 'KDR')
  },
  cops: {
    kills: fixedStat(['copsandcrims', 'kills'], 'Kills', 0),
    KDR: fixedStat(['copsandcrims', 'KDRatio'], 'KDR')
  },
  smash: {
    kills: fixedStat(['smashheroes', 'kills'], 'Kills', 0),
    wins: fixedStat(['smashheroes', 'wins'], 'Wins', 0)
  },
  woolwars: {
    KDR: fixedStat(['woolgames', 'woolWars', 'KDRatio'], 'KDR'),
    wins: fixedStat(['woolgames', 'woolWars', 'wins'], 'Wins', 0)
  },
  quakecraft: {
    kills: fixedStat(['quakecraft', 'kills'], 'Kills', 0),
    KDR: fixedStat(['quakecraft', 'KDRatio'], 'KDR')
  },
  tntgames: {
    wins: fixedStat(['tntgames', 'wins'], 'Wins', 0)
  }
}

export function getStatLabel(game: string, stat: string): string | undefined {
  return gameRegistries[game]?.[stat]?.label
}

export function getStatDecimals(game: string, stat: string): number {
  return gameRegistries[game]?.[stat]?.decimals ?? 2
}

export function extractStatValue(player: Player, game: string, stat: string): number | undefined {
  return gameRegistries[game]?.[stat]?.extract(player)
}

export function formatStatValue(value: number, decimals: number): string {
  return decimals > 0 ? value.toFixed(decimals) : Math.floor(value).toLocaleString()
}

export function getSmartThreshold(stat: string, currentValue: number): number {
  const lowerStat = stat.toLowerCase()
  if (lowerStat.includes('kdr') || lowerStat.includes('wlr') || lowerStat.includes('ratio')) {
    return 0.01
  }
  if (lowerStat.includes('level') || lowerStat.includes('star') || lowerStat.includes('streak')) {
    return 1
  }
  return Math.max(1, Math.floor(Math.sqrt(currentValue) / 2))
}
