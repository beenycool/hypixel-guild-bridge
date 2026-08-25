/* eslint-disable unicorn/no-null */
import { ChannelType, type Guild, GuildChannel } from 'discord.js'
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type { DatabaseManager } from '../../common/database-manager.js'

import { AntiAbuse } from './anti-abuse.js'
import { AuditLogger } from './audit-logger.js'
import { BracketGenerator, type GeneratedMatch } from './bracket-generator.js'
import { DeadlineScheduler } from './deadline-scheduler.js'
import { MatchManager } from './match-manager.js'
import { TournamentChannelManager } from './tournament-channel-manager.js'
import { TournamentNotifications } from './tournament-notifications.js'
import type { TournamentResultRow } from './tournament-notifications.js'
import type { Tournament, TournamentMatch, TournamentPlayer, TournamentReport } from './types.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from './types.js'

interface TournamentBroadcastEvent {
  type: string
  data: unknown
}

export class TournamentManager {
  public readonly bracketGenerator: BracketGenerator
  public readonly channelManager: TournamentChannelManager
  public readonly notifications: TournamentNotifications
  public readonly matchManager: MatchManager
  public readonly deadlineScheduler: DeadlineScheduler
  public readonly auditLogger: AuditLogger
  public readonly antiAbuse: AntiAbuse

  private readonly logger: Logger
  private readonly activeTournaments = new Map<number, Tournament>()
  private readonly eventHandlers = new Set<(event: TournamentBroadcastEvent) => void>()
  private readonly playerNameCache = new Map<number, { expiresAt: number; names: Map<number, string> }>()
  private static readonly PlayerNameCacheTtlMs = 10 * 60 * 1000

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly application: Application
  ) {
    this.logger = application.logger
    this.bracketGenerator = new BracketGenerator(this.logger)
    this.channelManager = new TournamentChannelManager(application)
    this.notifications = new TournamentNotifications(application)
    this.auditLogger = new AuditLogger(this.databaseManager, this.logger)
    this.antiAbuse = new AntiAbuse(this.databaseManager, this.logger)

    this.matchManager = new MatchManager(
      databaseManager,
      this.channelManager,
      this.notifications,
      async (id) => await this.getTournament(id),
      async (id) => await this.getPlayerNames(id),
      async (threadId) => await this.channelManager.checkProofAttachment(threadId),
      this.antiAbuse,
      (type, data) => {
        this.emitEvent(type, data)
      },
      async (id) => {
        await this.notifyTournamentCompleted(id)
      },
      this.bracketGenerator,
      this.logger,
      (id) => {
        this.invalidatePlayerNameCache(id)
      }
    )

    this.deadlineScheduler = new DeadlineScheduler(
      databaseManager,
      this.matchManager,
      this.notifications,
      this.logger,
      async (id) => await this.getPlayerNames(id),
      async (id) => {
        await this.startTournament(id)
      }
    )
  }

  public async load(): Promise<void> {
    const active = await this.databaseManager.queryRows<Tournament>(
      `SELECT * FROM "tournaments" WHERE "status" IN ($1, $2)`,
      [TournamentStatus.Signup, TournamentStatus.Active]
    )

    this.activeTournaments.clear()
    for (const t of active) {
      this.activeTournaments.set(t.id, t)
      this.logger.info(`[Tournament] Loaded #${t.id} (${t.name}) [${t.status}]`)
    }
    this.logger.info(`[Tournament] ${this.activeTournaments.size} active tournament(s) in memory`)
  }

  async rehydrate(): Promise<void> {
    for (const [id, tournament] of this.activeTournaments) {
      if (tournament.status !== TournamentStatus.Active && tournament.status !== TournamentStatus.Signup) {
        continue
      }

      this.logger.info(`[Tournament] Restoring state for #${id} (${tournament.name})`)

      const matches = await this.databaseManager.queryRows<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 ORDER BY "round", "matchIndex"',
        [id]
      )

      for (const match of matches) {
        if (match.status === MatchStatus.Active || match.status === MatchStatus.Reported) {
          this.logger.info(`[Tournament] Match #${match.id} (R${match.round}): status=${match.status}`)
          if (match.discordThreadId) {
            try {
              const client = this.application.discordInstance.getClient()
              const thread = await client.channels.fetch(match.discordThreadId).catch(() => undefined)
              if (!thread) {
                this.logger.warn(`Thread ${match.discordThreadId} for match ${match.id} not found, recreating...`)
                if (
                  match.status === MatchStatus.Active &&
                  tournament.discordChannelId !== undefined &&
                  match.player1Id !== undefined &&
                  match.player2Id !== undefined
                ) {
                  const p1 = await this.databaseManager.queryOne<TournamentPlayer>(
                    'SELECT * FROM "tournament_players" WHERE "id" = $1',
                    [match.player1Id]
                  )
                  const p2 = await this.databaseManager.queryOne<TournamentPlayer>(
                    'SELECT * FROM "tournament_players" WHERE "id" = $1',
                    [match.player2Id]
                  )
                  if (p1 !== undefined && p2 !== undefined) {
                    const names = await this.getPlayerNames(tournament.id)
                    const p1Name = names.get(p1.id) ?? 'Player 1'
                    const p2Name = names.get(p2.id) ?? 'Player 2'
                    const threadId = await this.channelManager.createMatchThread(
                      tournament.discordChannelId,
                      match,
                      p1,
                      p2,
                      p1Name,
                      p2Name
                    )
                    if (threadId !== undefined) {
                      await this.databaseManager.execute(
                        'UPDATE "tournament_matches" SET "discordThreadId" = $1 WHERE "id" = $2',
                        [threadId, match.id]
                      )
                      await this.notifications.notifyMatchReady(threadId, p1, p2, p1Name, p2Name)
                    }
                  }
                }
              }
            } catch {
              this.logger.warn(`Failed to fetch thread ${match.discordThreadId} for match ${match.id}`)
            }
          }

          if (match.status === MatchStatus.Reported) {
            this.logger.info(`Match ${match.id}: Checking reported status, looking for unreported opponent`)
            const reports = await this.databaseManager.queryRows<TournamentReport>(
              'SELECT * FROM "tournament_reports" WHERE "matchId" = $1',
              [match.id]
            )
            if (reports.length === 1) {
              const nonReporterId = reports[0].reporterId === match.player1Id ? match.player2Id : match.player1Id
              if (nonReporterId) {
                const players = await this.databaseManager.queryRows<{ playerUuid: string }>(
                  'SELECT "playerUuid" FROM "tournament_players" WHERE "id" = $1',
                  [nonReporterId]
                )
                if (players.length > 0) {
                  const uuid = players[0].playerUuid
                  this.logger.info(`Match ${match.id}: Reminding unreported player ${uuid} to submit report`)
                  this.notifications
                    .sendWhisper(
                      tournament.bridgeId,
                      uuid,
                      'Your opponent has reported. Please report your score or it may be auto-resolved!'
                    )
                    .catch(() => undefined)
                }
              }
            }
          }
        }

        if (match.status === MatchStatus.Bye && match.winnerId !== undefined) {
          this.logger.info(`Match ${match.id}: Rehydrating unadvanced BYE match, advancing winner ${match.winnerId}`)
          await this.matchManager.resolveByeMatch(match.id, match.winnerId).catch((error: unknown) => {
            this.logger.error(`Match ${match.id}: Failed to advance BYE winner during rehydration:`, error)
          })
        }

        if (match.status === MatchStatus.Disputed && match.deadlineAt) {
          const now = Math.floor(Date.now() / 1000)
          if (now > match.deadlineAt) {
            this.logger.info(`Match ${match.id}: Disputed match past deadline, notifying officers`)
            const names = await this.getPlayerNames(tournament.id)
            const p1Name = match.player1Id === undefined ? 'Player 1' : (names.get(match.player1Id) ?? 'Player 1')
            const p2Name = match.player2Id === undefined ? 'Player 2' : (names.get(match.player2Id) ?? 'Player 2')

            const reports = await this.databaseManager.queryRows<TournamentReport>(
              'SELECT * FROM "tournament_reports" WHERE "matchId" = $1',
              [match.id]
            )
            const r1Claimed = reports[0] ? (names.get(reports[0].claimedWinnerId) ?? 'Unknown') : 'Unknown'
            const r2Claimed = reports[1] ? (names.get(reports[1].claimedWinnerId) ?? 'Unknown') : 'Unknown'

            this.notifications
              .notifyDispute(tournament.bridgeId, match, p1Name, p2Name, r1Claimed, r2Claimed)
              .catch(() => undefined)
          }
        }
      }

      if (tournament.bracketMessageId && tournament.discordChannelId) {
        try {
          const client = this.application.discordInstance.getClient()
          const channel = await client.channels.fetch(tournament.discordChannelId).catch(() => null)
          if (channel?.isTextBased()) {
            const message = await channel.messages.fetch(tournament.bracketMessageId).catch(() => null)
            if (!message) {
              this.logger.warn(
                `Bracket message ${tournament.bracketMessageId} not found, will be re-created on next update`
              )
            }
          }
        } catch (error: unknown) {
          void error
        }
      }
    }

    this.logger.info('Tournament rehydration complete')
  }

  public startScheduler(): void {
    this.deadlineScheduler.start()
  }

  public stopScheduler(): void {
    this.deadlineScheduler.stop()
  }

  public onEvent(handler: (event: TournamentBroadcastEvent) => void): void {
    this.eventHandlers.add(handler)
  }

  private emitEvent(type: string, data: unknown): void {
    const event: TournamentBroadcastEvent = { type, data }
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch (error) {
        this.logger.warn(`Tournament ${type}: WS event handler error`, error)
      }
    }
  }

  public getActiveTournament(bridgeId: string): Tournament | undefined {
    return [...this.activeTournaments.values()].find((t) => t.bridgeId === bridgeId)
  }

  public async getTournament(id: number): Promise<Tournament | undefined> {
    const cached = this.activeTournaments.get(id)
    if (cached !== undefined) return cached

    return await this.databaseManager.queryOne<Tournament>('SELECT * FROM "tournaments" WHERE "id" = $1', [id])
  }

  public async createTournament(
    bridgeId: string,
    name: string,
    gameType: string,
    bestOf: number,
    createdBy: string,
    roundDeadlineHours = 48,
    startedAtUnix?: number,
    checkinWindowMinutes = 60,
    bracketFormat = 'single-elim'
  ): Promise<Tournament> {
    const existing = this.getActiveTournament(bridgeId)
    if (existing !== undefined) {
      throw new Error(`An active tournament already exists for this bridge: "${existing.name}"`)
    }

    const now = Math.floor(Date.now() / 1000)

    const checkinOpensAt = startedAtUnix === undefined ? undefined : startedAtUnix - checkinWindowMinutes * 60
    const checkinClosesAt = startedAtUnix ?? undefined

    this.logger.info(
      `createTournament: bridgeId=${bridgeId}, name="${name}", gameType="${gameType}", bestOf=${bestOf}, roundDeadlineHours=${roundDeadlineHours}, bracketFormat="${bracketFormat}", checkinWindowMinutes=${checkinWindowMinutes}`
    )

    const tournament = await this.databaseManager.queryOne<Tournament>(
      `INSERT INTO "tournaments" ("bridgeId", "name", "gameType", "bestOf", "status", "roundDeadlineHours", "createdBy", "createdAt", "checkinOpensAt", "checkinClosesAt", "startedAtUnix", "bracketFormat", "checkinWindowMinutes")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        bridgeId,
        name,
        gameType,
        bestOf,
        TournamentStatus.Signup,
        roundDeadlineHours,
        createdBy,
        now,
        checkinOpensAt ?? null,
        checkinClosesAt ?? null,
        startedAtUnix ?? null,
        bracketFormat,
        checkinWindowMinutes
      ]
    )

    if (tournament === undefined) {
      throw new Error('Failed to insert tournament into database.')
    }

    this.logger.info(
      `Tournament ${tournament.id} (${name}): Created successfully, checkinOpensAt=${checkinOpensAt ?? 'none'}, checkinClosesAt=${checkinClosesAt ?? 'none'}`
    )
    this.activeTournaments.set(tournament.id, tournament)
    this.updateMetrics()
    this.emitEvent('tournament.created', { tournament })
    return tournament
  }

  public async openCheckinManually(tournamentId: number): Promise<void> {
    const tournament = await this.getTournament(tournamentId)
    if (tournament === undefined) {
      throw new Error('Tournament not found or not active.')
    }
    if (tournament.status !== TournamentStatus.Signup) {
      throw new Error('Tournament is not in signup phase.')
    }
    if (tournament.checkinOpensAt !== undefined) {
      throw new Error('Check-in has already been opened for this tournament.')
    }

    const now = Math.floor(Date.now() / 1000)
    const checkinOpensAt = now
    const checkinClosesAt = tournament.startedAtUnix ?? checkinOpensAt + 3600

    this.logger.info(
      `Tournament ${tournamentId}: Opening check-in manually, checkinOpensAt=${checkinOpensAt}, checkinClosesAt=${checkinClosesAt}`
    )

    await this.databaseManager.execute(
      'UPDATE "tournaments" SET "checkinOpensAt" = $1, "checkinClosesAt" = $2 WHERE "id" = $3',
      [checkinOpensAt, checkinClosesAt, tournamentId]
    )

    const cached = this.activeTournaments.get(tournamentId)
    if (cached !== undefined) {
      cached.checkinOpensAt = checkinOpensAt
      cached.checkinClosesAt = checkinClosesAt
    }
  }

  public async checkinPlayer(tournamentId: number, playerUuid: string, discordId?: string): Promise<TournamentPlayer> {
    const tournament = this.activeTournaments.get(tournamentId)
    if (tournament === undefined) {
      throw new Error('Tournament not found or not active.')
    }
    if (tournament.status !== TournamentStatus.Signup) {
      throw new Error('Tournament signups are closed.')
    }

    const now = Math.floor(Date.now() / 1000)
    if (tournament.checkinOpensAt !== undefined && now < tournament.checkinOpensAt) {
      throw new Error('Check-in has not opened yet.')
    }
    if (tournament.checkinClosesAt !== undefined && now >= tournament.checkinClosesAt) {
      throw new Error('Check-in window has closed.')
    }

    this.logger.info(`Tournament ${tournamentId}: Checking in player ${playerUuid} (discordId=${discordId})`)

    const player = await this.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
      [tournamentId, playerUuid]
    )
    if (player === undefined) {
      throw new Error('Player is not registered for this tournament.')
    }
    if (player.status !== PlayerStatus.Registered) {
      throw new Error('Player is already checked in.')
    }

    const updated = await this.databaseManager.queryOne<TournamentPlayer>(
      'UPDATE "tournament_players" SET "checkedInAt" = $1, "status" = $2, "discordId" = COALESCE($3, "discordId") WHERE "id" = $4 RETURNING *',
      [now, PlayerStatus.CheckedIn, discordId ?? null, player.id]
    )

    if (updated === undefined) {
      throw new Error('Failed to check in player.')
    }

    this.logger.info(`Tournament ${tournamentId}: Player ${playerUuid} checked in successfully (playerId=${player.id})`)
    return updated
  }

  public async addPlayer(
    tournamentId: number,
    playerUuid: string,
    discordId: string | undefined
  ): Promise<TournamentPlayer> {
    const tournament = this.activeTournaments.get(tournamentId)
    if (tournament === undefined) {
      throw new Error('Tournament not found or not active.')
    }
    if (tournament.status !== TournamentStatus.Signup) {
      throw new Error('Tournament signups are closed.')
    }

    const now = Math.floor(Date.now() / 1000)

    this.logger.info(`Tournament ${tournamentId}: Adding player ${playerUuid} (discordId=${discordId ?? 'none'})`)

    const existing = await this.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
      [tournamentId, playerUuid]
    )
    if (existing !== undefined) {
      throw new Error('Player is already registered for this tournament.')
    }

    if (discordId !== undefined) {
      const signupCheck = this.antiAbuse.checkSignupRate(discordId)
      if (!signupCheck.allowed) {
        throw new Error(signupCheck.reason ?? 'Please slow down. You are joining/leaving too fast.')
      }
    }
    const existingPlayers = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT "playerUuid" FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )
    const altCheck = await this.antiAbuse.checkAltAccounts(tournamentId, [
      ...existingPlayers.map((p) => p.playerUuid),
      playerUuid
    ])
    if (!altCheck.allowed) {
      throw new Error(altCheck.reason ?? 'FLAGGED: Potential alt account.')
    }

    const player = await this.databaseManager.queryOne<TournamentPlayer>(
      `INSERT INTO "tournament_players" ("tournamentId", "playerUuid", "discordId", "seed", "status")
       VALUES ($1, $2, $3, 0, $4)
       RETURNING *`,
      [tournamentId, playerUuid, discordId ?? null, PlayerStatus.Registered]
    )

    if (player === undefined) {
      throw new Error('Failed to register player.')
    }
    this.invalidatePlayerNameCache(tournamentId)

    const autoCheckin = this.application.core.bridgeConfigurations.getTournamentAutoCheckin(tournament.bridgeId)
    if (
      autoCheckin &&
      tournament.checkinOpensAt !== undefined &&
      now >= tournament.checkinOpensAt &&
      now < (tournament.checkinClosesAt ?? Infinity)
    ) {
      this.logger.info(`Tournament ${tournamentId}: Auto-checkin for player ${playerUuid}, checkin window is open`)
      const updated = await this.databaseManager.queryOne<TournamentPlayer>(
        'UPDATE "tournament_players" SET "checkedInAt" = $1, "status" = $2 WHERE "id" = $3 RETURNING *',
        [now, PlayerStatus.CheckedIn, player.id]
      )
      if (updated !== undefined) {
        return updated
      }
    }

    return player
  }

  public invalidatePlayerNameCache(tournamentId: number): void {
    this.playerNameCache.delete(tournamentId)
  }

  public async removePlayer(tournamentId: number, playerUuid: string): Promise<void> {
    const tournament = this.activeTournaments.get(tournamentId)
    if (tournament === undefined) {
      throw new Error('Tournament not found or not active.')
    }
    if (tournament.status !== TournamentStatus.Signup && tournament.status !== TournamentStatus.Active) {
      throw new Error('Tournament cannot be edited in this state.')
    }

    this.logger.info(`Tournament ${tournamentId}: Removing player ${playerUuid}`)

    const player = await this.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
      [tournamentId, playerUuid]
    )
    if (player === undefined) {
      throw new Error('Player is not registered for this tournament.')
    }
    if (tournament.status === TournamentStatus.Signup && player.discordId !== undefined) {
      const signupCheck = this.antiAbuse.checkSignupRate(player.discordId)
      if (!signupCheck.allowed) {
        throw new Error(signupCheck.reason ?? 'Please slow down. You are joining/leaving too fast.')
      }
    }

    if (tournament.status === TournamentStatus.Active) {
      const liveMatches = await this.databaseManager.queryRows<TournamentMatch>(
        `SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND ("player1Id" = $2 OR "player2Id" = $3) AND "status" IN ($4, $5, $6, $7, $8)`,
        [
          tournamentId,
          player.id,
          player.id,
          MatchStatus.Active,
          MatchStatus.Reported,
          MatchStatus.Disputed,
          MatchStatus.BothConfirmed,
          MatchStatus.Pending
        ]
      )
      if (liveMatches.length > 0) {
        throw new Error('Player is in a live match. Forfeit or substitute them out first.')
      }
      await this.databaseManager.execute(
        'DELETE FROM "tournament_results" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
        [tournamentId, playerUuid]
      )
    }

    const affected = await this.databaseManager.execute(
      'DELETE FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
      [tournamentId, playerUuid]
    )

    if (affected === 0) {
      throw new Error('Player is not registered for this tournament.')
    }
    this.invalidatePlayerNameCache(tournamentId)
    await this.auditLogger.log(tournamentId, 'player_removed', 'web-ui', undefined, playerUuid, {
      phase: tournament.status
    })
    this.logger.info(`Tournament ${tournamentId}: Player ${playerUuid} removed successfully`)
  }

  public async setSeeds(
    tournamentId: number,
    seeds: { playerId: number; seed: number }[],
    actorDiscordId = 'web-ui'
  ): Promise<void> {
    const tournament = await this.getTournament(tournamentId)
    if (tournament === undefined) {
      throw new Error('Tournament not found or not active.')
    }
    if (tournament.status !== TournamentStatus.Signup) {
      throw new Error('Seeds can only be edited during the signup phase.')
    }

    const players = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )
    const playerIds = new Set(players.map((p) => p.id))

    if (!Array.isArray(seeds) || seeds.length === 0) {
      throw new Error('seeds array is required.')
    }
    const seenSeeds = new Set<number>()
    for (const entry of seeds) {
      if (
        !Number.isInteger(entry.playerId) ||
        !Number.isInteger(entry.seed) ||
        entry.seed < 1 ||
        entry.seed > players.length
      ) {
        throw new Error(`Invalid seed entry for player ${entry.playerId}: seed must be 1-${players.length}.`)
      }
      if (!playerIds.has(entry.playerId)) {
        throw new Error(`Player ${entry.playerId} is not registered in this tournament.`)
      }
      if (seenSeeds.has(entry.seed)) {
        throw new Error(`Duplicate seed value ${entry.seed}.`)
      }
      seenSeeds.add(entry.seed)
    }

    await this.databaseManager.transaction(async (txClient) => {
      for (const entry of seeds) {
        await txClient.query('UPDATE "tournament_players" SET "seed" = $1 WHERE "id" = $2', [
          entry.seed,
          entry.playerId
        ])
      }
    })

    this.logger.info(
      `Tournament ${tournamentId}: Updated seeds for ${seeds.length} player(s) (actor=${actorDiscordId})`
    )
    await this.auditLogger.log(tournamentId, 'seeds_updated', actorDiscordId, undefined, undefined, {
      count: seeds.length
    })
    this.emitEvent('tournament.seeds_updated', { tournamentId })
  }

  public async updateTournament(
    tournamentId: number,
    updates: {
      name?: string
      gameType?: string
      bestOf?: number
      roundDeadlineHours?: number
      checkinWindowMinutes?: number
      bracketFormat?: string
    },
    actorDiscordId = 'web-ui'
  ): Promise<Tournament> {
    const tournament = await this.getTournament(tournamentId)
    if (tournament === undefined) {
      throw new Error('Tournament not found or not active.')
    }
    if (tournament.status !== TournamentStatus.Signup) {
      throw new Error('Tournament settings can only be edited during the signup phase.')
    }

    const columnMap: Record<string, string> = {
      name: 'name',
      gameType: 'gameType',
      bestOf: 'bestOf',
      roundDeadlineHours: 'roundDeadlineHours',
      checkinWindowMinutes: 'checkinWindowMinutes',
      bracketFormat: 'bracketFormat'
    }

    const allowedBracketFormats = new Set(['single-elim', 'double-elim', 'round-robin'])
    const sets: string[] = []
    const parameters: unknown[] = []
    let index = 1

    if (updates.name !== undefined) {
      const name = updates.name.trim()
      if (name.length === 0 || name.length > 80) {
        throw new Error('name must be 1-80 characters.')
      }
      sets.push(`"${columnMap.name}" = $${index++}`)
      parameters.push(name)
    }
    if (updates.gameType !== undefined) {
      const gameType = updates.gameType.trim()
      if (gameType.length === 0) {
        throw new Error('gameType must not be empty.')
      }
      sets.push(`"${columnMap.gameType}" = $${index++}`)
      parameters.push(gameType)
    }
    if (updates.bestOf !== undefined) {
      if (!Number.isInteger(updates.bestOf) || updates.bestOf < 1 || updates.bestOf % 2 === 0 || updates.bestOf > 9) {
        throw new Error('bestOf must be an odd integer between 1 and 9.')
      }
      sets.push(`"${columnMap.bestOf}" = $${index++}`)
      parameters.push(updates.bestOf)
    }
    if (updates.roundDeadlineHours !== undefined) {
      if (
        !Number.isInteger(updates.roundDeadlineHours) ||
        updates.roundDeadlineHours < 1 ||
        updates.roundDeadlineHours > 720
      ) {
        throw new Error('roundDeadlineHours must be an integer between 1 and 720.')
      }
      sets.push(`"${columnMap.roundDeadlineHours}" = $${index++}`)
      parameters.push(updates.roundDeadlineHours)
    }
    if (updates.checkinWindowMinutes !== undefined) {
      if (
        !Number.isInteger(updates.checkinWindowMinutes) ||
        updates.checkinWindowMinutes < 0 ||
        updates.checkinWindowMinutes > 1440
      ) {
        throw new Error('checkinWindowMinutes must be an integer between 0 and 1440.')
      }
      sets.push(`"${columnMap.checkinWindowMinutes}" = $${index++}`)
      parameters.push(updates.checkinWindowMinutes)
    }
    if (updates.bracketFormat !== undefined) {
      if (!allowedBracketFormats.has(updates.bracketFormat)) {
        throw new Error('Unsupported bracketFormat. Use single-elim, double-elim, or round-robin.')
      }
      sets.push(`"${columnMap.bracketFormat}" = $${index++}`)
      parameters.push(updates.bracketFormat)
    }

    if (sets.length === 0) {
      throw new Error('No settings to update.')
    }
    parameters.push(tournamentId)

    const updated = await this.databaseManager.queryOne<Tournament>(
      `UPDATE "tournaments" SET ${sets.join(', ')} WHERE "id" = $${index} RETURNING *`,
      parameters
    )
    if (updated === undefined) {
      throw new Error('Failed to update tournament.')
    }

    this.activeTournaments.set(updated.id, updated)
    await this.auditLogger.log(tournamentId, 'settings_updated', actorDiscordId, undefined, undefined, {
      fields: sets.map((s) => s.split('"')[1])
    })
    this.logger.info(`Tournament ${tournamentId}: Settings updated (actor=${actorDiscordId})`)
    this.emitEvent('tournament.edited', { tournamentId, tournament: updated })
    return updated
  }

  public async reopenTournament(tournamentId: number, actorDiscordId = 'web-ui'): Promise<Tournament> {
    const tournament = await this.databaseManager.queryOne<Tournament>('SELECT * FROM "tournaments" WHERE "id" = $1', [
      tournamentId
    ])
    if (tournament === undefined) {
      throw new Error('Tournament not found.')
    }
    if (tournament.status !== TournamentStatus.Cancelled) {
      throw new Error('Only cancelled tournaments can be reopened.')
    }

    const existingActive = this.getActiveTournament(tournament.bridgeId)
    if (existingActive !== undefined && existingActive.id !== tournamentId) {
      throw new Error(`An active tournament already exists for this bridge: "${existingActive.name}". Cancel it first.`)
    }

    this.logger.info(`Tournament ${tournamentId} (${tournament.name}): Reopening into signup phase`)

    await this.databaseManager.transaction(async (txClient) => {
      await txClient.query(
        'DELETE FROM "tournament_reports" WHERE "matchId" IN (SELECT "id" FROM "tournament_matches" WHERE "tournamentId" = $1)',
        [tournamentId]
      )
      await txClient.query('DELETE FROM "tournament_matches" WHERE "tournamentId" = $1', [tournamentId])
      await txClient.query('DELETE FROM "tournament_results" WHERE "tournamentId" = $1', [tournamentId])
      await txClient.query(
        `UPDATE "tournaments" SET "status" = $1, "winnerId" = NULL, "currentRound" = 0, "totalRounds" = 0,
           "startedAt" = NULL, "completedAt" = NULL, "startedAtUnix" = NULL,
           "checkinOpensAt" = NULL, "checkinClosesAt" = NULL,
           "discordChannelId" = NULL, "bracketMessageId" = NULL, "categoryChannelId" = NULL, "liveChannelId" = NULL
         WHERE "id" = $2`,
        [TournamentStatus.Signup, tournamentId]
      )
      await txClient.query(
        'UPDATE "tournament_players" SET "status" = $1, "seed" = 0, "checkedInAt" = NULL WHERE "tournamentId" = $2',
        [PlayerStatus.Registered, tournamentId]
      )
    })

    const reopened = await this.databaseManager.queryOne<Tournament>('SELECT * FROM "tournaments" WHERE "id" = $1', [
      tournamentId
    ])
    if (reopened === undefined) {
      throw new Error('Failed to reopen tournament.')
    }

    this.activeTournaments.set(reopened.id, reopened)
    await this.auditLogger.log(tournamentId, 'tournament_reopened', actorDiscordId)
    this.updateMetrics()
    this.emitEvent('tournament.reopened', { tournamentId, tournament: reopened })
    return reopened
  }

  public async resolveGuildForBridge(bridgeId: string): Promise<Guild | undefined> {
    const bridgeConfigs = this.application.core.bridgeConfigurations
    const channelIds = [
      ...bridgeConfigs.getPublicChannelIds(bridgeId),
      ...bridgeConfigs.getOfficerChannelIds(bridgeId),
      ...bridgeConfigs.getLoggerChannelIds(bridgeId),
      ...bridgeConfigs.getPromoteChannelIds(bridgeId)
    ]
    const client = this.application.discordInstance.getClient()

    for (const channelId of channelIds) {
      const channel = client.channels.cache.get(channelId)
      if (channel instanceof GuildChannel) return channel.guild
    }
    for (const channelId of channelIds) {
      const channel = await client.channels.fetch(channelId).catch(() => undefined)
      if (channel instanceof GuildChannel) return channel.guild
    }
    return undefined
  }

  public async startTournament(tournamentId: number, guildId?: string, categoryId?: string): Promise<void> {
    const tournament = this.activeTournaments.get(tournamentId)
    if (tournament === undefined) {
      throw new Error('Tournament not found or not active.')
    }
    if (tournament.status !== TournamentStatus.Signup) {
      throw new Error('Tournament is already active.')
    }

    const bridgeGuild = await this.resolveGuildForBridge(tournament.bridgeId)
    const resolvedGuildId = bridgeGuild?.id ?? guildId
    if (resolvedGuildId === undefined) {
      throw new Error(
        `Could not resolve a Discord guild for bridge "${tournament.bridgeId}". Configure the bridge's channels or pass guildId.`
      )
    }
    if (guildId !== undefined && bridgeGuild !== undefined && guildId !== bridgeGuild.id) {
      this.logger.warn(
        `Tournament ${tournamentId}: requested guild ${guildId} differs from bridge "${tournament.bridgeId}" guild ${bridgeGuild.id} (${bridgeGuild.name}); using the bridge guild`
      )
    }

    this.logger.info(
      `Tournament ${tournamentId} (${tournament.name}): Starting tournament for guild=${resolvedGuildId} (${bridgeGuild?.name ?? 'unknown'}), categoryId=${categoryId ?? 'default'}`
    )

    const players = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )
    this.logger.info(`Tournament ${tournamentId}: Fetched ${players.length} total players`)

    const checkedIn = players.filter((p) => p.checkedInAt !== undefined)
    this.logger.info(`Tournament ${tournamentId}: ${checkedIn.length} players checked in`)
    const minParticipants = this.application.core.bridgeConfigurations.getTournamentMinParticipants(tournament.bridgeId)
    const required = Math.max(minParticipants, 2)
    if (checkedIn.length < required) {
      await this.notifications.notifyInsufficientCheckins(tournament, checkedIn.length, required).catch(() => undefined)
      throw new Error(`Not enough checked-in players. Minimum required: ${required}, got ${checkedIn.length}.`)
    }

    const shuffled = [...checkedIn]
    for (let index = shuffled.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
    }

    this.logger.info(`Tournament ${tournamentId}: Generating bracket matches`)
    const bracketFormat =
      tournament.bracketFormat ??
      this.application.core.bridgeConfigurations.getTournamentDefaultBracketFormat(tournament.bridgeId)
    const { totalRounds, matches } = this.bracketGenerator.generateInitialMatches(
      tournamentId,
      shuffled,
      tournament.roundDeadlineHours,
      bracketFormat
    )
    this.logger.info(
      `Tournament ${tournamentId}: Generated ${matches.length} matches across ${totalRounds} rounds (format=${bracketFormat})`
    )

    const now = Math.floor(Date.now() / 1000)
    const createdMatches: TournamentMatch[] = []
    const idMap = new Map<string, number>()

    this.logger.info(`Tournament ${tournamentId}: Starting transaction (status flip, seeds, match inserts)`)

    await this.databaseManager.transaction(async (client) => {
      // Conditional flip: a concurrent start (manual or scheduler) that got here first
      // wins the row and this attempt aborts with no partial state.
      const flipped = await client.query<{ id: number }>(
        `UPDATE "tournaments" SET "status" = $1, "startedAt" = $2, "currentRound" = 1, "totalRounds" = $3
         WHERE "id" = $4 AND "status" = $5 RETURNING "id"`,
        [TournamentStatus.Active, now, totalRounds, tournamentId, TournamentStatus.Signup]
      )
      if (flipped.rows.length === 0) {
        throw new Error('Tournament is already active or no longer in the signup phase.')
      }

      for (const [index, element] of shuffled.entries()) {
        element.seed = index + 1
        await client.query('UPDATE "tournament_players" SET "seed" = $1, "status" = $2 WHERE "id" = $3', [
          index + 1,
          PlayerStatus.Active,
          element.id
        ])
      }

      const matchesByRound = new Map<number, GeneratedMatch[]>()
      for (const m of matches) {
        if (m.round === undefined) continue
        const list = matchesByRound.get(m.round) ?? []
        list.push(m)
        matchesByRound.set(m.round, list)
      }

      for (let r = totalRounds; r >= 1; r--) {
        const roundList = matchesByRound.get(r) ?? []
        this.logger.info(`Tournament ${tournamentId}: Inserting ${roundList.length} matches for round ${r}`)
        for (const m of roundList) {
          let nextMatchId: number | undefined
          if (m.winnerNext !== undefined) {
            nextMatchId = idMap.get(`${m.winnerNext.round}_${m.winnerNext.matchIndex}`) ?? undefined
          }
          let loserNextMatchId: number | undefined
          if (m.loserNext !== undefined) {
            loserNextMatchId = idMap.get(`${m.loserNext.round}_${m.loserNext.matchIndex}`) ?? undefined
          }
          const result = await client.query<{ id: number }>(
            `INSERT INTO "tournament_matches"
               ("tournamentId", "round", "matchIndex", "player1Id", "player2Id", "winnerId", "nextMatchId", "loserNextMatchId", "status", "player1Wins", "player2Wins", "deadlineAt", "completedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING "id"`,
            [
              m.tournamentId,
              m.round,
              m.matchIndex,
              m.player1Id ?? null,
              m.player2Id ?? null,
              m.winnerId ?? null,
              nextMatchId ?? null,
              loserNextMatchId ?? null,
              m.status,
              m.player1Wins,
              m.player2Wins,
              m.deadlineAt ?? null,
              m.completedAt ?? null
            ]
          )

          const databaseId = result.rows[0].id
          idMap.set(`${r}_${m.matchIndex}`, databaseId)

          createdMatches.push({
            id: databaseId,
            tournamentId: m.tournamentId,
            round: m.round,
            matchIndex: m.matchIndex,
            player1Id: m.player1Id,
            player2Id: m.player2Id,
            winnerId: m.winnerId,
            nextMatchId,
            loserNextMatchId,
            status: m.status,
            player1Wins: m.player1Wins,
            player2Wins: m.player2Wins,
            discordThreadId: undefined,
            deadlineAt: m.deadlineAt,
            warningsSent: 0,
            completedAt: m.completedAt,
            deadlineExtensionMinutes: 0,
            manuallyExtended: false,
            hadProofAttachment: false
          } as TournamentMatch)
        }
      }
    })

    tournament.status = TournamentStatus.Active
    tournament.startedAt = now
    tournament.currentRound = 1
    tournament.totalRounds = totalRounds

    this.logger.info(`Tournament ${tournamentId}: All ${createdMatches.length} matches inserted successfully`)

    const configCategoryId = this.application.core.bridgeConfigurations.getTournamentCategoryId(tournament.bridgeId)
    let resolvedCategoryId = categoryId ?? configCategoryId

    if (tournament.categoryChannelId === undefined && resolvedCategoryId === undefined) {
      try {
        const createdCategoryId = await this.channelManager.createTournamentCategory(resolvedGuildId, tournament.name)
        if (createdCategoryId !== undefined) {
          resolvedCategoryId = createdCategoryId
          this.logger.info(
            `Tournament ${tournamentId}: Created tournament category ${createdCategoryId}, storing categoryChannelId`
          )
          await this.databaseManager.execute('UPDATE "tournaments" SET "categoryChannelId" = $1 WHERE "id" = $2', [
            createdCategoryId,
            tournamentId
          ])
          tournament.categoryChannelId = createdCategoryId

          const liveChannelId = await this.channelManager.createLiveChannel(
            resolvedGuildId,
            tournament.name,
            createdCategoryId
          )
          if (liveChannelId !== undefined) {
            this.logger.info(`Tournament ${tournamentId}: Created live channel ${liveChannelId}, storing liveChannelId`)
            await this.databaseManager.execute('UPDATE "tournaments" SET "liveChannelId" = $1 WHERE "id" = $2', [
              liveChannelId,
              tournamentId
            ])
            tournament.liveChannelId = liveChannelId
          }
        }
      } catch (error) {
        this.logger.warn(`Tournament ${tournamentId}: Failed to create tournament category/live channel`, error)
      }
    }

    this.logger.info(
      `Tournament ${tournamentId}: Creating bracket channel (categoryId=${resolvedCategoryId ?? 'none'})`
    )
    const channel = await this.channelManager.createBracketChannel(resolvedGuildId, tournament.name, resolvedCategoryId)
    if (channel === undefined) {
      this.logger.info(`Tournament ${tournamentId}: Failed to create bracket channel`)
    } else {
      this.logger.info(`Tournament ${tournamentId}: Bracket channel created: #${channel.name} (${channel.id})`)
      await this.databaseManager.execute('UPDATE "tournaments" SET "discordChannelId" = $1 WHERE "id" = $2', [
        channel.id,
        tournamentId
      ])
      tournament.discordChannelId = channel.id

      const names = await this.getPlayerNames(tournamentId)

      const initialMessage = await channel.send({ content: 'Initializing bracket...' })
      this.logger.info(`Tournament ${tournamentId}: Initial bracket message sent (messageId=${initialMessage.id})`)
      await this.databaseManager.execute('UPDATE "tournaments" SET "bracketMessageId" = $1 WHERE "id" = $2', [
        initialMessage.id,
        tournamentId
      ])
      tournament.bracketMessageId = initialMessage.id

      const usedMessageId = await this.channelManager.updateBracketEmbed(
        channel.id,
        initialMessage.id,
        tournament,
        createdMatches,
        shuffled,
        names
      )
      if (usedMessageId !== undefined && usedMessageId !== tournament.bracketMessageId) {
        await this.databaseManager.execute('UPDATE "tournaments" SET "bracketMessageId" = $1 WHERE "id" = $2', [
          usedMessageId,
          tournamentId
        ])
        tournament.bracketMessageId = usedMessageId
      }

      const activeRound1 = createdMatches.filter((m) => m.round === 1 && m.status === MatchStatus.Active)
      this.logger.info(`Tournament ${tournamentId}: Spawning ${activeRound1.length} match threads for round 1`)
      for (const m of activeRound1) {
        const p1 = shuffled.find((p) => p.id === m.player1Id)
        const p2 = shuffled.find((p) => p.id === m.player2Id)

        if (p1 !== undefined && p2 !== undefined) {
          const p1Name = names.get(p1.id) ?? 'Player 1'
          const p2Name = names.get(p2.id) ?? 'Player 2'

          this.logger.info(`Match ${m.id}: Creating thread for ${p1Name} vs ${p2Name}`)
          const threadId = await this.channelManager.createMatchThread(channel.id, m, p1, p2, p1Name, p2Name)

          if (threadId === undefined) {
            this.logger.info(`Match ${m.id}: Failed to create thread`)
          } else {
            this.logger.info(`Match ${m.id}: Thread created (threadId=${threadId})`)
            await this.databaseManager.execute(
              'UPDATE "tournament_matches" SET "discordThreadId" = $1 WHERE "id" = $2',
              [threadId, m.id]
            )
            m.discordThreadId = threadId
            await this.notifications.notifyMatchReady(threadId, p1, p2, p1Name, p2Name)
          }

          await this.notifications.notifyMatchStart(
            tournament.bridgeId,
            m,
            p1.playerUuid,
            p2.playerUuid,
            p1Name,
            p2Name
          )
        }
      }

      this.logger.info(`Tournament ${tournamentId}: Updating bracket embed with thread links`)
      const secondUsedMessageId = await this.channelManager.updateBracketEmbed(
        channel.id,
        tournament.bracketMessageId,
        tournament,
        createdMatches,
        shuffled,
        names
      )
      if (secondUsedMessageId !== undefined && secondUsedMessageId !== tournament.bracketMessageId) {
        await this.databaseManager.execute('UPDATE "tournaments" SET "bracketMessageId" = $1 WHERE "id" = $2', [
          secondUsedMessageId,
          tournamentId
        ])
        tournament.bracketMessageId = secondUsedMessageId
      }
    }

    // BYE advancement must run regardless of whether the bracket channel could be
    // created — BYE matches carry no deadline, so the scheduler can never pick them up.
    const byeRound1 = createdMatches.filter((m) => m.round === 1 && m.status === MatchStatus.Bye)
    if (byeRound1.length > 0) {
      this.logger.info(`Tournament ${tournamentId}: Auto-resolving ${byeRound1.length} BYE match(es) in round 1`)
    }
    for (const m of byeRound1) {
      if (m.winnerId !== undefined) {
        this.logger.info(`Match ${m.id}: Resolving BYE match, winnerId=${m.winnerId}`)
        await this.matchManager.resolveByeMatch(m.id, m.winnerId).catch((error: unknown) => {
          this.logger.error(`Error resolving BYE match ${m.id}:`, error)
        })
      }
    }

    this.logger.info(`Tournament ${tournamentId}: Tournament started successfully`)
    await this.notifications.announceTournamentStarted(tournament, checkedIn.length).catch(() => undefined)
    this.updateMetrics()
    this.emitEvent('tournament.started', { tournament })
  }

  public async cancelTournament(tournamentId: number): Promise<void> {
    const tournament = await this.getTournament(tournamentId)
    if (tournament === undefined) {
      this.logger.info(`Tournament ${tournamentId}: Cancel called but tournament not found`)
      return
    }

    this.logger.info(`Tournament ${tournamentId} (${tournament.name}): Cancelling tournament`)

    await this.databaseManager.execute('UPDATE "tournaments" SET "status" = $1 WHERE "id" = $2', [
      TournamentStatus.Cancelled,
      tournamentId
    ])

    this.activeTournaments.delete(tournamentId)

    const activeMatches = await this.databaseManager.queryRows<TournamentMatch>(
      `SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "status" IN ($2, $3, $4, $5)`,
      [tournamentId, MatchStatus.Active, MatchStatus.Reported, MatchStatus.Disputed, MatchStatus.BothConfirmed]
    )
    this.logger.info(`Tournament ${tournamentId}: Archiving ${activeMatches.length} active match threads`)

    for (const match of activeMatches) {
      if (match.discordThreadId !== undefined) {
        this.logger.info(`Match ${match.id}: Archiving thread ${match.discordThreadId}`)
        await this.channelManager.archiveMatchThread(match.discordThreadId, 'Tournament cancelled.')
      }
    }

    if (tournament.categoryChannelId !== undefined) {
      this.logger.info(`Tournament ${tournamentId}: Archiving tournament category ${tournament.categoryChannelId}`)
      await this.channelManager.archiveTournamentCategory(tournament)
    }

    this.updateMetrics()
    this.emitEvent('tournament.cancelled', { tournamentId })
  }

  async recordResults(tournamentId: number): Promise<TournamentResultRow[]> {
    const tournament = await this.databaseManager.queryOne<Tournament>('SELECT * FROM "tournaments" WHERE "id" = $1', [
      tournamentId
    ])
    if (tournament === undefined) {
      this.logger.info(`Tournament ${tournamentId}: recordResults called but tournament not found`)
      return []
    }

    this.logger.info(`Tournament ${tournamentId} (${tournament.name}): Recording results`)

    const players = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )

    const matches = await this.databaseManager.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
      [tournamentId]
    )

    this.logger.info(
      `Tournament ${tournamentId}: Recording results for ${players.length} players from ${matches.length} matches`
    )

    await this.databaseManager.transaction(async (txClient) => {
      await txClient.query('DELETE FROM "tournament_results" WHERE "tournamentId" = $1', [tournamentId])

      const records = new Map<number, { wins: number; losses: number; roundsReached: number }>()
      for (const player of players) {
        const playerMatches = matches.filter((m) => m.player1Id === player.id || m.player2Id === player.id)
        const wins = playerMatches.filter((m) => m.winnerId === player.id).length
        const losses = playerMatches.filter(
          (m) =>
            Boolean(m.winnerId) && m.winnerId !== player.id && (m.player1Id === player.id || m.player2Id === player.id)
        ).length
        const isWinner = tournament.winnerId === player.id
        const totalRounds = tournament.totalRounds || 1
        const roundsReached = isWinner
          ? totalRounds
          : Math.max(...playerMatches.filter((m) => m.winnerId !== player.id).map((m) => m.round), 1)
        records.set(player.id, { wins, losses, roundsReached })
      }

      const isRoundRobin = tournament.bracketFormat === 'round-robin'
      let rrPlacements: Map<number, number> | undefined
      if (isRoundRobin) {
        const sorted = players.toSorted((a, b) => {
          if (tournament.winnerId === a.id) return -1
          if (tournament.winnerId === b.id) return 1
          const ra = records.get(a.id) ?? { wins: 0, losses: 0, roundsReached: 1 }
          const rb = records.get(b.id) ?? { wins: 0, losses: 0, roundsReached: 1 }
          if (ra.wins !== rb.wins) return rb.wins - ra.wins
          if (ra.losses !== rb.losses) return ra.losses - rb.losses
          const h2h = matches.find(
            (m) => (m.player1Id === a.id && m.player2Id === b.id) || (m.player1Id === b.id && m.player2Id === a.id)
          )
          if (h2h?.winnerId !== undefined) return h2h.winnerId === a.id ? -1 : 1
          return a.seed - b.seed
        })
        // Placements follow the sorted order directly so the head-to-head and seed
        // tiebreakers decide final positions for players with identical records.
        rrPlacements = new Map<number, number>()
        for (const [index, player] of sorted.entries()) {
          rrPlacements.set(player.id, index + 1)
        }
      }
      const placementFor = (player: TournamentPlayer): number => {
        if (tournament.winnerId === player.id) return 1
        if (isRoundRobin) return rrPlacements?.get(player.id) ?? 2
        const record = records.get(player.id)
        const totalRounds = tournament.totalRounds || 1
        return totalRounds - (record?.roundsReached ?? 1) + 2
      }

      for (const player of players) {
        const record = records.get(player.id) ?? { wins: 0, losses: 0, roundsReached: 1 }
        const isWinner = tournament.winnerId === player.id
        const placement = placementFor(player)

        this.logger.debug(
          `Tournament ${tournamentId}: Player ${player.playerUuid} — wins=${record.wins}, losses=${record.losses}, roundsReached=${record.roundsReached}, placement=${placement}, champion=${isWinner}`
        )

        await txClient.query(
          `INSERT INTO "tournament_results" ("playerUuid", "discordId", "tournamentId", "placement", "roundsReached", "wins", "losses", "champion")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            player.playerUuid,
            player.discordId,
            tournamentId,
            placement,
            record.roundsReached,
            record.wins,
            record.losses,
            isWinner
          ]
        )
      }
    })

    const results = await this.databaseManager.queryRows<TournamentResultRow>(
      'SELECT * FROM "tournament_results" WHERE "tournamentId" = $1 ORDER BY "placement" ASC',
      [tournamentId]
    )
    return results
  }

  public async notifyTournamentCompleted(tournamentId: number): Promise<void> {
    const tournament = await this.databaseManager.queryOne<Tournament>('SELECT * FROM "tournaments" WHERE "id" = $1', [
      tournamentId
    ])
    if (tournament === undefined) {
      this.logger.info(`Tournament ${tournamentId}: notifyTournamentCompleted skipped (status=not found)`)
      return
    }
    if (tournament.status !== TournamentStatus.Completed) {
      this.logger.info(`Tournament ${tournamentId}: notifyTournamentCompleted skipped (status=${tournament.status})`)
      return
    }

    this.logger.info(`Tournament ${tournamentId}: Finalizing tournament completion`)

    const results = await this.recordResults(tournamentId).catch((error: unknown) => {
      this.logger.error(`Tournament ${tournamentId}: Failed to record results`, error)
      return []
    })

    await this.notifications.announceResults(tournament, results).catch((error: unknown) => {
      this.logger.error(`Tournament ${tournamentId}: Failed to announce results`, error)
    })

    const cached = this.activeTournaments.get(tournamentId)
    if (cached !== undefined) {
      cached.status = TournamentStatus.Completed
      cached.winnerId = tournament.winnerId
      cached.completedAt = tournament.completedAt
    }

    this.updateMetrics()
    this.emitEvent('tournament.completed', { tournamentId, winnerId: tournament.winnerId })
  }

  public updateMetrics(): void {
    const metrics = this.application.metrics
    if (!metrics) return

    let active = 0
    let signup = 0

    for (const [, t] of this.activeTournaments) {
      if (t.status === TournamentStatus.Active) active++
      if (t.status === TournamentStatus.Signup) signup++
    }

    metrics.onTournamentActiveChange(active + signup)
  }

  public async rewindMatch(matchId: number, actorDiscordId?: string): Promise<void> {
    const match = await this.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
    if (match === undefined) {
      throw new Error('Match not found.')
    }
    if (match.status !== MatchStatus.Completed) {
      throw new Error('Match is not completed.')
    }

    const tournament = await this.databaseManager.queryOne<Tournament>('SELECT * FROM "tournaments" WHERE "id" = $1', [
      match.tournamentId
    ])
    if (tournament === undefined) {
      throw new Error('Tournament not found.')
    }
    const now = Math.floor(Date.now() / 1000)
    const winnerId = match.winnerId
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id

    this.logger.info(`Tournament ${tournament.id}, Match ${matchId}: Rewinding match (winnerId=${winnerId ?? 'none'})`)

    const deletedThreadIds: string[] = []

    await this.databaseManager.transaction(async (database) => {
      if (tournament.status === TournamentStatus.Completed) {
        await database.query(
          'UPDATE "tournaments" SET "status" = $1, "winnerId" = NULL, "completedAt" = NULL WHERE "id" = $2',
          [TournamentStatus.Active, tournament.id]
        )

        await database.query('DELETE FROM "tournament_results" WHERE "tournamentId" = $1', [tournament.id])
      }
      if (tournament.currentRound > match.round) {
        await database.query('UPDATE "tournaments" SET "currentRound" = $1 WHERE "id" = $2', [
          match.round,
          tournament.id
        ])
      }

      // Rewinding a double-elim bracket reset match: restore totalRounds so round
      // progression treats the original grand final as the final round again.
      if (
        match.nextMatchId === undefined &&
        match.loserNextMatchId === undefined &&
        tournament.bracketFormat === 'double-elim' &&
        match.round === tournament.totalRounds &&
        tournament.totalRounds > 1
      ) {
        const roundSiblings = await database.query<{ id: number }>(
          'SELECT "id" FROM "tournament_matches" WHERE "tournamentId" = $1 AND "round" = $2',
          [tournament.id, match.round]
        )
        if (roundSiblings.rows.length > 1) {
          await database.query('UPDATE "tournaments" SET "totalRounds" = $1 WHERE "id" = $2', [
            match.round - 1,
            tournament.id
          ])
          tournament.totalRounds = match.round - 1
        }
      }

      await database.query(
        'UPDATE "tournament_matches" SET "status" = $1, "winnerId" = NULL, "completedAt" = NULL, "player1Wins" = 0, "player2Wins" = 0, "deadlineAt" = $2, "manuallyExtended" = FALSE, "deadlineExtensionMinutes" = 0, "warningsSent" = 0, "hadProofAttachment" = FALSE WHERE "id" = $3',
        [MatchStatus.Active, now + tournament.roundDeadlineHours * 3600, matchId]
      )

      await database.query('DELETE FROM "tournament_reports" WHERE "matchId" = $1', [matchId])

      if (winnerId !== undefined) {
        await database.query('UPDATE "tournament_players" SET "status" = $1 WHERE "id" = $2', [
          PlayerStatus.Active,
          winnerId
        ])
      }
      if (loserId !== undefined) {
        await database.query('UPDATE "tournament_players" SET "status" = $1 WHERE "id" = $2', [
          PlayerStatus.Active,
          loserId
        ])
      }

      for (const [nextMatchId, advancedPlayerId] of [
        [match.nextMatchId, winnerId],
        [match.loserNextMatchId, loserId]
      ] as const) {
        if (nextMatchId === undefined || advancedPlayerId === undefined) continue

        const nextMatch = await this.databaseManager.queryOne<TournamentMatch>(
          'SELECT * FROM "tournament_matches" WHERE "id" = $1',
          [nextMatchId],
          database
        )
        if (nextMatch === undefined) continue

        const slotField =
          nextMatch.player1Id === advancedPlayerId
            ? 'player1Id'
            : nextMatch.player2Id === advancedPlayerId
              ? 'player2Id'
              : undefined

        if (slotField !== undefined) {
          await database.query(`UPDATE "tournament_matches" SET "${slotField}" = NULL WHERE "id" = $1`, [nextMatch.id])
        }

        if (nextMatch.status === MatchStatus.Active) {
          await database.query(
            'UPDATE "tournament_matches" SET "status" = $1, "deadlineAt" = NULL, "discordThreadId" = NULL WHERE "id" = $2',
            [MatchStatus.Pending, nextMatch.id]
          )
        }

        if (nextMatch.discordThreadId !== undefined) {
          deletedThreadIds.push(nextMatch.discordThreadId)
        }
      }
    })

    const client = this.application.discordInstance.getClient()

    for (const threadId of deletedThreadIds) {
      await client.channels
        .fetch(threadId)
        .catch(() => null)
        .then((ch) => {
          if (ch != null && (ch.type === ChannelType.PrivateThread || ch.type === ChannelType.PublicThread)) {
            void ch.delete().catch(() => undefined)
          }
        })
    }

    if (match.discordThreadId !== undefined) {
      const thread = await client.channels.fetch(match.discordThreadId).catch(() => null)
      if (thread != null && (thread.type === ChannelType.PrivateThread || thread.type === ChannelType.PublicThread)) {
        await thread.setLocked(false).catch(() => undefined)
        await thread.setArchived(false).catch(() => undefined)
      }
    }

    await this.auditLogger.log(tournament.id, 'match_undo', actorDiscordId ?? 'system', matchId, undefined, {
      round: match.round,
      matchIndex: match.matchIndex,
      winnerId
    })

    if (tournament.discordChannelId !== undefined && tournament.bracketMessageId !== undefined) {
      await this.refreshBracketEmbed(tournament)
    }

    const p1 = await this.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "id" = $1',
      [match.player1Id ?? -1]
    )
    const p2 = await this.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "id" = $1',
      [match.player2Id ?? -1]
    )
    const rewindMessage =
      '⚠️ Your match result was reviewed and reset by staff. Please replay the match before the new deadline.'
    for (const player of [p1, p2]) {
      if (player !== undefined && !player.playerUuid.startsWith('00000000-0000-0000-0000-')) {
        await this.notifications
          .sendWhisper(tournament.bridgeId, player.playerUuid, rewindMessage)
          .catch(() => undefined)
      }
    }

    const cached = this.activeTournaments.get(tournament.id)
    if (cached !== undefined) {
      cached.status = TournamentStatus.Active
      cached.winnerId = undefined
      cached.completedAt = undefined
      if (cached.currentRound > match.round) {
        cached.currentRound = match.round
      }
      cached.totalRounds = tournament.totalRounds
    }

    this.updateMetrics()
    this.emitEvent('tournament.undo', { tournamentId: tournament.id, matchId })
  }

  private async refreshBracketEmbed(tournament: Tournament): Promise<void> {
    if (tournament.discordChannelId === undefined || tournament.bracketMessageId === undefined) return
    const matches = await this.databaseManager.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
      [tournament.id]
    )
    const players = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournament.id]
    )
    const names = await this.getPlayerNames(tournament.id)
    const usedMessageId = await this.channelManager.updateBracketEmbed(
      tournament.discordChannelId,
      tournament.bracketMessageId,
      tournament,
      matches,
      players,
      names
    )
    if (usedMessageId !== undefined && usedMessageId !== tournament.bracketMessageId) {
      await this.databaseManager.execute('UPDATE "tournaments" SET "bracketMessageId" = $1 WHERE "id" = $2', [
        usedMessageId,
        tournament.id
      ])
      tournament.bracketMessageId = usedMessageId
    }
  }

  async getAllTournaments(): Promise<Tournament[]> {
    return await this.databaseManager.queryRows<Tournament>('SELECT * FROM "tournaments" ORDER BY "createdAt" DESC')
  }

  async getMatches(tournamentId: number): Promise<TournamentMatch[]> {
    return await this.databaseManager.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 ORDER BY "round", "matchIndex"',
      [tournamentId]
    )
  }

  async getPlayers(tournamentId: number): Promise<TournamentPlayer[]> {
    return await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )
  }

  public async getPlayerNames(tournamentId: number): Promise<Map<number, string>> {
    const cached = this.playerNameCache.get(tournamentId)
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.names

    const players = await this.databaseManager.queryRows<{ id: number; playerUuid: string }>(
      'SELECT "id", "playerUuid" FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )

    const map = new Map<number, string>()
    for (const p of players) {
      if (p.playerUuid.startsWith('00000000-0000-0000-0000-')) {
        map.set(p.id, `Player #${p.id}`)
        continue
      }
      const profile = await this.application.mojangApi.profileByUuid(p.playerUuid).catch(() => undefined)
      map.set(p.id, profile?.name ?? `Player #${p.id}`)
    }

    this.playerNameCache.set(tournamentId, {
      expiresAt: Date.now() + TournamentManager.PlayerNameCacheTtlMs,
      names: map
    })
    return map
  }
}
