import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber, shortenNumber } from '../common/utility'

export default class Skywars extends HypixelPlayerCommand {
  private static readonly PrestigeSchemes = [
    { level: 0, name: 'Stone' },
    { level: 10, name: 'Iron' },
    { level: 20, name: 'Gold' },
    { level: 30, name: 'Diamond' },
    { level: 40, name: 'Ruby' },
    { level: 50, name: 'Crystal' },
    { level: 60, name: 'Amethyst' },
    { level: 70, name: 'Opal' },
    { level: 80, name: 'Topaz' },
    { level: 90, name: 'Jade' },
    { level: 100, name: 'Mythic' },
    { level: 110, name: 'Bloody' },
    { level: 120, name: 'Cobalt' },
    { level: 130, name: 'Content' },
    { level: 140, name: 'Crimson' },
    { level: 150, name: 'Firefly' },
    { level: 160, name: 'Emerald' },
    { level: 170, name: 'Abyss' },
    { level: 180, name: 'Sapphire' },
    { level: 190, name: 'Emergency' },
    { level: 200, name: 'Mythic II' },
    { level: 210, name: 'Mulberry' },
    { level: 220, name: 'Slate' },
    { level: 230, name: 'Blood God' },
    { level: 240, name: 'Midnight' },
    { level: 250, name: 'Sun' },
    { level: 260, name: 'Bulb' },
    { level: 270, name: 'Twilight' },
    { level: 280, name: 'Natural' },
    { level: 290, name: 'Icicle' },
    { level: 300, name: 'Mythic III' },
    { level: 310, name: 'Graphite' },
    { level: 320, name: 'Punk' },
    { level: 330, name: 'Meltdown' },
    { level: 340, name: 'Iridescent' },
    { level: 350, name: 'Marigold' },
    { level: 360, name: 'Beach' },
    { level: 370, name: 'Spark' },
    { level: 380, name: 'Target' },
    { level: 390, name: 'Limelight' },
    { level: 400, name: 'Mythic IV' },
    { level: 410, name: 'Cerulean' },
    { level: 420, name: 'Magical' },
    { level: 430, name: 'Luminous' },
    { level: 440, name: 'Synthesis' },
    { level: 450, name: 'Burn' },
    { level: 460, name: 'Dramatic' },
    { level: 470, name: 'Radiant' },
    { level: 480, name: 'Tidal' },
    { level: 490, name: 'Firework' },
    { level: 500, name: 'Mythic V' }
  ]

  private static readonly PrestigeEmblems = [
    { level: 0, emblem: '✯' },
    { level: 50, emblem: '^_^' },
    { level: 100, emblem: '@_@' },
    { level: 150, emblem: 'δvδ' },
    { level: 200, emblem: 'zz_zz' },
    { level: 250, emblem: '■·■' },
    { level: 300, emblem: 'ಠ_ಠ' },
    { level: 350, emblem: 'o...0' },
    { level: 400, emblem: '>u<' },
    { level: 450, emblem: 'v-v' },
    { level: 500, emblem: '༼つ◕_◕༽つ' }
  ]

  constructor() {
    super({
      triggers: ['skywars', 'skywar', 'sw'],
      description: "Returns a player's SkyWars stats",
      example: `sw %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const stats = player.stats?.skywars
    if (stats === undefined) return `${givenUsername} has never played SkyWars before?`

    const level = stats.level
    const kills = stats.kills
    const kdRatio = stats.KDRatio
    const wins = stats.wins
    const wlRatio = stats.WLRatio
    const coins = stats.coins

    const prestige = Skywars.PrestigeSchemes.findLast((p) => level >= p.level)?.name ?? 'Stone'
    const emblem = Skywars.PrestigeEmblems.findLast((error) => level >= error.level)?.emblem ?? '✯'

    return (
      `[${prestige} ${level.toFixed(0)}${emblem}] ${givenUsername} ` +
      `Kills: ${shortenNumber(kills)} KDR: ${formatStatNumber(kdRatio)} | ` +
      `Wins: ${shortenNumber(wins)} WLR: ${formatStatNumber(wlRatio)} | ` +
      `Coins: ${shortenNumber(coins)}`
    )
  }
}
