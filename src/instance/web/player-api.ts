import type http from 'node:http'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type { Permission } from '../../common/application-event.js'

import { buildTokenSet, verifyToken } from './auth.js'
import { sendSuccess, sendError } from './api-utils.js'

const PlayerPrefix = '/api/player'

interface PlayerStats {
  bedwars:
    | {
        wins: number
        losses: number
        finalKills: number
        finalDeaths: number
        bedsBroken: number
        wlr: number
        fkdr: number
      }
    | undefined
  skywars:
    | {
        wins: number
        losses: number
        kills: number
        deaths: number
        wlr: number
        kdr: number
      }
    | undefined
  duels:
    | {
        wins: number
        losses: number
        wlr: number
        currentWinstreak: number
        bestWinstreak: number
      }
    | undefined
}

export class PlayerApiHandler {
  constructor(
    private readonly application: Application,
    private readonly logger: Logger
  ) {}

  private verifyAuth(request: http.IncomingMessage, response: http.ServerResponse): Permission | undefined {
    const webConfig = this.application.config.web
    if (!webConfig?.signingSecret) return undefined
    const result = verifyToken(buildTokenSet(webConfig), request.headers.authorization)
    if (!result.ok) {
      sendError(response, 'UNAUTHORIZED', 'Invalid token', 401)
      return undefined
    }
    return result.permission
  }

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const rawUrl = request.url
    if (!rawUrl) return false

    const [pathPart] = rawUrl.split('?')
    if (!pathPart.startsWith(PlayerPrefix + '/')) return false

    if (request.method !== 'GET') {
      this.sendMethodNotAllowed(response, ['GET'])
      return true
    }

    const permission = this.verifyAuth(request, response)
    if (permission === undefined) return true

    const username = pathPart.slice(PlayerPrefix.length + 1)
    if (!username || username.length === 0) {
      sendError(response, 'VALIDATION_ERROR', 'Missing username', 400)
      return true
    }

    await this.handlePlayerLookup(response, username)
    return true
  }

  private async handlePlayerLookup(response: http.ServerResponse, username: string): Promise<void> {
    let uuid: string
    try {
      const profile = await this.application.mojangApi.profileByUsername(username)
      uuid = profile.id
      username = profile.name
    } catch {
      sendError(response, 'VALIDATION_ERROR', 'Invalid username', 400)
      return
    }

    let player: Record<string, unknown> | undefined
    try {
      player = (await this.application.hypixelApi.getPlayer(uuid, { raw: true })) as unknown as Record<string, unknown>
    } catch (error: unknown) {
      this.logger.warn('Failed to fetch player data for %s', username, error)
    }

    const stats = this.extractStats(player)

    let guildInfo: { name: string; rank: string; joinedAt: number } | undefined
    try {
      const guild = await this.application.hypixelApi.getGuild('player', uuid, {})
      const member = guild.members.find((m) => m.uuid === uuid)
      if (member) {
        guildInfo = {
          name: guild.name,
          rank: member.rank,
          joinedAt: member.joinedAt.getTime()
        }
      }
    } catch {
      // guild lookup not critical
    }

    let skyblockProfiles: unknown[] | undefined
    try {
      const raw = await this.application.hypixelApi.getSkyblockProfiles(uuid, { raw: true })
      skyblockProfiles = raw as unknown as unknown[]
    } catch {
      // skyblock not critical
    }

    sendSuccess(response, {
      uuid,
      username,
      player: player,
      stats,
      guild: guildInfo,
      skyblockProfiles
    })
  }

  private extractStats(player: Record<string, unknown> | undefined): PlayerStats {
    if (!player) {
      return { bedwars: undefined, skywars: undefined, duels: undefined }
    }

    const pStats = player.stats as Record<string, unknown> | undefined

    const bedwars = this.extractBedwars(pStats?.Bedwars as Record<string, unknown> | undefined)
    const skywars = this.extractSkywars(pStats?.SkyWars as Record<string, unknown> | undefined)
    const duels = this.extractDuels(pStats?.Duels as Record<string, unknown> | undefined)

    return { bedwars, skywars, duels }
  }

  private extractBedwars(bw: Record<string, unknown> | undefined): PlayerStats['bedwars'] {
    if (!bw) return undefined
    const wins = bw.wins_bedwars as number
    const losses = bw.losses_bedwars as number
    const finalKills = bw.final_kills_bedwars as number
    const finalDeaths = bw.final_deaths_bedwars as number
    const bedsBroken = bw.beds_broken_bedwars as number
    return {
      wins,
      losses,
      finalKills,
      finalDeaths,
      bedsBroken,
      wlr: losses > 0 ? Number((wins / losses).toFixed(2)) : wins,
      fkdr: finalDeaths > 0 ? Number((finalKills / finalDeaths).toFixed(2)) : finalKills
    }
  }

  private extractSkywars(sw: Record<string, unknown> | undefined): PlayerStats['skywars'] {
    if (!sw) return undefined
    const wins = sw.wins as number
    const losses = sw.losses as number
    const kills = sw.kills as number
    const deaths = sw.deaths as number
    return {
      wins,
      losses,
      kills,
      deaths,
      wlr: losses > 0 ? Number((wins / losses).toFixed(2)) : wins,
      kdr: deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills
    }
  }

  private extractDuels(d: Record<string, unknown> | undefined): PlayerStats['duels'] {
    if (!d) return undefined
    const wins = d.wins as number
    const losses = d.losses as number
    return {
      wins,
      losses,
      wlr: losses > 0 ? Number((wins / losses).toFixed(2)) : wins,
      currentWinstreak: d.current_winstreak as number,
      bestWinstreak: d.best_winstreak as number
    }
  }

  private sendMethodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '))
    sendError(response, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405)
  }
}
