import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'
import { formatStatNumber, shortenNumber } from '../common/utility.js'

type ArcadeSubcommand =
  | 'summary'
  | 'dropper'
  | 'zombies'
  | 'partygames'
  | 'pixelparty'
  | 'blockingdead'
  | 'bountyhunters'
  | 'dragonwars'
  | 'enderspleef'
  | 'farmhunt'
  | 'football'
  | 'galaxywars'
  | 'hideandseek'
  | 'holeinthewall'
  | 'hypixelsays'
  | 'miniwalls'
  | 'throwout'

const SubcommandAliases = new Map<string, ArcadeSubcommand>([
  ['summary', 'summary'],
  ['overall', 'summary'],
  ['all', 'summary'],

  ['dropper', 'dropper'],
  ['droppers', 'dropper'],
  ['drop', 'dropper'],

  ['zombies', 'zombies'],
  ['zombie', 'zombies'],
  ['zb', 'zombies'],

  ['partygames', 'partygames'],
  ['party', 'partygames'],
  ['pg', 'partygames'],

  ['pixelparty', 'pixelparty'],
  ['pixel', 'pixelparty'],
  ['pp', 'pixelparty'],

  ['blockingdead', 'blockingdead'],
  ['blocking', 'blockingdead'],
  ['dead', 'blockingdead'],
  ['bd', 'blockingdead'],

  ['bountyhunters', 'bountyhunters'],
  ['bounty', 'bountyhunters'],
  ['bh', 'bountyhunters'],

  ['dragonwars', 'dragonwars'],
  ['dragon', 'dragonwars'],
  ['dw', 'dragonwars'],

  ['enderspleef', 'enderspleef'],
  ['spleef', 'enderspleef'],
  ['es', 'enderspleef'],

  ['farmhunt', 'farmhunt'],
  ['farm', 'farmhunt'],
  ['fh', 'farmhunt'],

  ['football', 'football'],
  ['soccer', 'football'],
  ['fb', 'football'],

  ['galaxywars', 'galaxywars'],
  ['galaxy', 'galaxywars'],
  ['gw', 'galaxywars'],

  ['hideandseek', 'hideandseek'],
  ['hide', 'hideandseek'],
  ['has', 'hideandseek'],

  ['holeinthewall', 'holeinthewall'],
  ['hole', 'holeinthewall'],
  ['hitw', 'holeinthewall'],

  ['hypixelsays', 'hypixelsays'],
  ['says', 'hypixelsays'],
  ['simonsays', 'hypixelsays'],
  ['hs', 'hypixelsays'],

  ['miniwalls', 'miniwalls'],
  ['mw', 'miniwalls'],
  ['miniw', 'miniwalls'],

  ['throwout', 'throwout'],
  ['throw', 'throwout'],
  ['to', 'throwout']
])

export default class Arcade extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['arcade', 'arc'],
      description: "Returns a player's Arcade games stats with optional game mode filter",
      example: `arcade [mode] %s`
    })
  }

  protected override resolveUsername(context: ChatCommandContext): string {
    return this.parseArgs(context).username
  }

  private parseArgs(context: ChatCommandContext): { subcommand: ArcadeSubcommand; username: string } {
    const firstArg = context.args[0]?.toLowerCase()
    const matchedSubcommand = firstArg ? SubcommandAliases.get(firstArg) : undefined

    if (matchedSubcommand) {
      return {
        subcommand: matchedSubcommand,
        username: context.args[1] ?? context.username
      }
    }

    return {
      subcommand: 'summary',
      username: context.args[0] ?? context.username
    }
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    const { subcommand } = this.parseArgs(context)
    const stats = player.stats?.arcade as Record<string, any> | undefined

    if (stats === undefined) return `${givenUsername} has never played Arcade games.` + this.formatPingSuffix()

    switch (subcommand) {
      case 'dropper': {
        const d = stats.dropper
        if (!d) return `${givenUsername} has never played Dropper.` + this.formatPingSuffix()
        const wins = d.wins ?? 0
        const games = d.gamesPlayed ?? 0
        const flawless = d.flawlessGames ?? 0
        const maps = d.mapsCompleted ?? 0
        const fastest = d.fastestGame ? `${(d.fastestGame / 1000).toFixed(1)}s` : '-'
        return (
          `[Dropper] ${givenUsername}: Wins: ${shortenNumber(wins)} | Games: ${shortenNumber(games)} | ` +
          `Flawless: ${shortenNumber(flawless)} | Maps: ${shortenNumber(maps)} | Fastest: ${fastest}` +
          this.formatPingSuffix()
        )
      }

      case 'zombies': {
        const z = stats.zombies
        if (!z) return `${givenUsername} has never played Zombies.` + this.formatPingSuffix()
        const overall = z.overall ?? z
        const wins = overall.wins ?? 0
        const kills = overall.zombieKills ?? 0
        const bestRound = overall.bestRound ?? 0
        const revives = overall.playersRevived ?? 0
        const deaths = overall.deaths ?? 0
        return (
          `[Zombies] ${givenUsername}: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | ` +
          `Best Round: ${bestRound} | Revives: ${shortenNumber(revives)} | Deaths: ${shortenNumber(deaths)}` +
          this.formatPingSuffix()
        )
      }

      case 'partygames': {
        const pg = stats.partyGames
        if (!pg) return `${givenUsername} has never played Party Games.` + this.formatPingSuffix()
        const wins = pg.wins ?? 0
        const roundWins = pg.roundWins ?? 0
        const stars = pg.stars ?? 0
        return (
          `[Party Games] ${givenUsername}: Wins: ${shortenNumber(wins)} | Round Wins: ${shortenNumber(roundWins)} | ` +
          `Stars: ${shortenNumber(stars)}` +
          this.formatPingSuffix()
        )
      }

      case 'pixelparty': {
        const pp = stats.pixelParty
        if (!pp) return `${givenUsername} has never played Pixel Party.` + this.formatPingSuffix()
        const wins = pp.wins ?? 0
        const games = pp.gamesPlayed ?? 0
        const rounds = pp.roundsPlayed ?? 0
        const wlr = pp.WLRatio ?? (pp.losses ? wins / pp.losses : wins)
        return (
          `[Pixel Party] ${givenUsername}: Wins: ${shortenNumber(wins)} | Games: ${shortenNumber(games)} | ` +
          `WLR: ${formatStatNumber(wlr)} | Rounds: ${shortenNumber(rounds)}` +
          this.formatPingSuffix()
        )
      }

      case 'blockingdead': {
        const bd = stats.blockingDead
        if (!bd) return `${givenUsername} has never played Blocking Dead.` + this.formatPingSuffix()
        const wins = bd.wins ?? 0
        const kills = bd.kills ?? 0
        const headshots = bd.headshots ?? 0
        return (
          `[Blocking Dead] ${givenUsername}: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | ` +
          `Headshots: ${shortenNumber(headshots)}` +
          this.formatPingSuffix()
        )
      }

      case 'bountyhunters': {
        const bh = stats.bountyHunters
        if (!bh) return `${givenUsername} has never played Bounty Hunters.` + this.formatPingSuffix()
        const wins = bh.wins ?? 0
        const kills = bh.kills ?? 0
        const deaths = bh.deaths ?? 0
        const kdr = bh.KDRatio ?? (deaths ? kills / deaths : kills)
        return (
          `[Bounty Hunters] ${givenUsername}: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | ` +
          `Deaths: ${shortenNumber(deaths)} | KDR: ${formatStatNumber(kdr)}` +
          this.formatPingSuffix()
        )
      }

      case 'dragonwars': {
        const dw = stats.dragonWars
        if (!dw) return `${givenUsername} has never played Dragon Wars.` + this.formatPingSuffix()
        const wins = dw.wins ?? 0
        const kills = dw.kills ?? 0
        return (
          `[Dragon Wars] ${givenUsername}: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)}` +
          this.formatPingSuffix()
        )
      }

      case 'enderspleef': {
        const es = stats.enderSpleef
        if (!es) return `${givenUsername} has never played Ender Spleef.` + this.formatPingSuffix()
        const wins = es.wins ?? 0
        const kills = es.kills ?? 0
        const blocks = es.blocksDestroyed ?? 0
        return (
          `[Ender Spleef] ${givenUsername}: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | ` +
          `Blocks Destroyed: ${shortenNumber(blocks)}` +
          this.formatPingSuffix()
        )
      }

      case 'farmhunt': {
        const fh = stats.farmHunt
        if (!fh) return `${givenUsername} has never played Farm Hunt.` + this.formatPingSuffix()
        const wins = fh.wins ?? 0
        const animalWins = fh.winsAsAnimal ?? 0
        const hunterWins = fh.winsAsHunter ?? 0
        const kills = fh.kills ?? 0
        const taunts = fh.tauntsUsed ?? 0
        return (
          `[Farm Hunt] ${givenUsername}: Wins: ${shortenNumber(wins)} (Animal: ${shortenNumber(animalWins)}, ` +
          `Hunter: ${shortenNumber(hunterWins)}) | Kills: ${shortenNumber(kills)} | Taunts: ${shortenNumber(taunts)}` +
          this.formatPingSuffix()
        )
      }

      case 'football': {
        const fb = stats.football
        if (!fb) return `${givenUsername} has never played Football.` + this.formatPingSuffix()
        const wins = fb.wins ?? 0
        const goals = fb.goals ?? 0
        const kicks = fb.kicks ?? 0
        const powerKicks = fb.powerKicks ?? 0
        return (
          `[Football] ${givenUsername}: Wins: ${shortenNumber(wins)} | Goals: ${shortenNumber(goals)} | ` +
          `Kicks: ${shortenNumber(kicks)} | Power Kicks: ${shortenNumber(powerKicks)}` +
          this.formatPingSuffix()
        )
      }

      case 'galaxywars': {
        const gw = stats.galaxyWars
        if (!gw) return `${givenUsername} has never played Galaxy Wars.` + this.formatPingSuffix()
        const wins = gw.wins ?? 0
        const kills = gw.kills ?? 0
        const deaths = gw.deaths ?? 0
        const shots = gw.shotsFired ?? 0
        return (
          `[Galaxy Wars] ${givenUsername}: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | ` +
          `Deaths: ${shortenNumber(deaths)} | Shots: ${shortenNumber(shots)}` +
          this.formatPingSuffix()
        )
      }

      case 'hideandseek': {
        const has = stats.hideAndSeek
        if (!has) return `${givenUsername} has never played Hide and Seek.` + this.formatPingSuffix()
        const seekerWins = has.winsAsSeeker ?? (has.partyPooper?.winsAsSeeker ?? 0) + (has.propHunt?.winsAsSeeker ?? 0)
        const hiderWins = has.winsAsHider ?? (has.partyPooper?.winsAsHider ?? 0) + (has.propHunt?.winsAsHider ?? 0)
        const wins = (has.partyPooper?.wins ?? 0) + (has.propHunt?.wins ?? 0) || seekerWins + hiderWins
        return (
          `[Hide & Seek] ${givenUsername}: Wins: ${shortenNumber(wins)} ` +
          `(Hider: ${shortenNumber(hiderWins)}, Seeker: ${shortenNumber(seekerWins)})` +
          this.formatPingSuffix()
        )
      }

      case 'holeinthewall': {
        const hitw = stats.holeInTheWall
        if (!hitw) return `${givenUsername} has never played Hole in the Wall.` + this.formatPingSuffix()
        const wins = hitw.wins ?? 0
        const rounds = hitw.rounds ?? 0
        const highScore = hitw.scoreRecordOverall ?? hitw.scoreRecordNormal ?? 0
        return (
          `[Hole in the Wall] ${givenUsername}: Wins: ${shortenNumber(wins)} | Rounds: ${shortenNumber(rounds)} | ` +
          `Record Score: ${shortenNumber(highScore)}` +
          this.formatPingSuffix()
        )
      }

      case 'hypixelsays': {
        const hs = stats.hypixelSays
        if (!hs) return `${givenUsername} has never played Hypixel Says.` + this.formatPingSuffix()
        const wins = hs.wins ?? 0
        const rounds = hs.rounds ?? 0
        const roundWins = hs.roundWins ?? 0
        const topScore = hs.topScore ?? 0
        return (
          `[Hypixel Says] ${givenUsername}: Wins: ${shortenNumber(wins)} | Rounds: ${shortenNumber(rounds)} | ` +
          `Round Wins: ${shortenNumber(roundWins)} | Top Score: ${shortenNumber(topScore)}` +
          this.formatPingSuffix()
        )
      }

      case 'miniwalls': {
        const mw = stats.miniWalls
        if (!mw) return `${givenUsername} has never played Mini Walls.` + this.formatPingSuffix()
        const wins = mw.wins ?? 0
        const kills = mw.kills ?? 0
        const deaths = mw.deaths ?? 0
        const kdr = mw.KDRatio ?? (deaths ? kills / deaths : kills)
        const finals = mw.finalKills ?? 0
        const witherKills = mw.witherKills ?? 0
        return (
          `[Mini Walls] ${givenUsername}: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | ` +
          `KDR: ${formatStatNumber(kdr)} | Finals: ${shortenNumber(finals)} | Wither Kills: ${shortenNumber(witherKills)}` +
          this.formatPingSuffix()
        )
      }

      case 'throwout': {
        const to = stats.throwOut
        if (!to) return `${givenUsername} has never played Throw Out.` + this.formatPingSuffix()
        const wins = to.wins ?? 0
        const kills = to.kills ?? 0
        const deaths = to.deaths ?? 0
        const kdr = to.KDRatio ?? (deaths ? kills / deaths : kills)
        return (
          `[Throw Out] ${givenUsername}: Wins: ${shortenNumber(wins)} | Kills: ${shortenNumber(kills)} | ` +
          `Deaths: ${shortenNumber(deaths)} | KDR: ${formatStatNumber(kdr)}` +
          this.formatPingSuffix()
        )
      }

      case 'summary':
      default: {
        const coins = stats.coins ?? 0
        const dropperWins = stats.dropper?.wins ?? 0
        const zombiesWins = stats.zombies?.overall?.wins ?? 0
        const pgWins = stats.partyGames?.wins ?? 0
        const pixelWins = stats.pixelParty?.wins ?? 0
        const footballWins = stats.football?.wins ?? 0
        const mwWins = stats.miniWalls?.wins ?? 0

        return (
          `${givenUsername}'s Arcade: Coins: ${shortenNumber(coins)} | ` +
          `Wins: Dropper: ${shortenNumber(dropperWins)}, Zombies: ${shortenNumber(zombiesWins)}, ` +
          `PG: ${shortenNumber(pgWins)}, Pixel: ${shortenNumber(pixelWins)}, ` +
          `Football: ${shortenNumber(footballWins)}, MiniWalls: ${shortenNumber(mwWins)}` +
          this.formatPingSuffix()
        )
      }
    }
  }
}

