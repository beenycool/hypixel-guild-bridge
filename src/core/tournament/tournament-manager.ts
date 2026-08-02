/* eslint-disable unicorn/no-null */
import { ChannelType } from 'discord.js'
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
import type { Tournament, TournamentMatch, TournamentPlayer } from './types.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from './types.js'

export interface TournamentBroadcastEvent {
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

    // Bind helpers to match manager
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
      this.logger
    )

    this.deadlineScheduler = new DeadlineScheduler(
      databaseManager,
      this.matchManager,
      this.notifications,
      this.logger,
      async (id) => await this.getPlayerNames(id)
    )
  }

  /**
   * Load active tournaments from the database.
   */
  public async load(): Promise<void> {
    const active = await this.databaseManager.queryRows<Tournament>(
      `SELECT * FROM "tournaments" WHERE "status" IN ($1, $2)`,
      [TournamentStatus.Signup, TournamentStatus.Active]
    )

    this.activeTournaments.clear()
    for (const t of active) {
      this.activeTournaments.set(t.id, t)
      this.logger.info(
        `Tournament ${t.id} (${t.name}): Loaded active tournament, status=${t.status}, bridgeId=${t.bridgeId}`
      )
    }
    this.logger.info(`Loaded ${this.activeTournaments.size} active tournaments from database.`)
  }

  async rehydrate(): Promise<void> {
    this.logger?.info('Rehydrating tournament state from database...')

    for (const [id, tournament] of this.activeTournaments) {
      if (tournament.status !== TournamentStatus.Active && tournament.status !== TournamentStatus.Signup) {
        this.logger.info(`Tournament ${id}: Skipping rehydration, status=${tournament.status}`)
        continue
      }

      this.logger.info(`Tournament ${id} (${tournament.name}): Rehydrating ${tournament.status} state...`)

      const matches = await this.databaseManager.queryRows<any>(
        'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 ORDER BY "round", "matchIndex"',
        [id]
      )

      this.logger.info(`Tournament ${id}: Found ${matches.length} matches for rehydration`)

      for (const match of matches) {
        if (match.status === MatchStatus.Active || match.status === MatchStatus.Reported) {
          this.logger.info(`Match ${match.id}: Rehydrating, status=${match.status}, round=${match.round}`)
          if (match.discordThreadId) {
            try {
              const client = this.application.discordInstance.getClient()
              const thread = await client.channels.fetch(match.discordThreadId).catch(() => undefined)
              if (!thread) {
                this.logger?.warn(`Thread ${match.discordThreadId} for match ${match.id} not found, recreating...`)
              }
            } catch {
              this.logger?.warn(`Failed to fetch thread ${match.discordThreadId} for match ${match.id}`)
            }
          }

          if (match.status === MatchStatus.Reported) {
            this.logger.info(`Match ${match.id}: Checking reported status, looking for unreported opponent`)
            const reports = await this.databaseManager.queryRows<any>(
              'SELECT * FROM "tournament_reports" WHERE "matchId" = $1',
              [match.id]
            )
            if (reports.length === 1) {
              const nonReporterId = reports[0].reporterId === match.player1Id ? match.player2Id : match.player1Id
              if (nonReporterId) {
                const players = await this.databaseManager.queryRows<any>(
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
                    .catch(() => {})
                }
              }
            }
          }
        }

        if (match.status === MatchStatus.Bye && match.winnerId !== undefined) {
          this.logger.info(
            `Match ${match.id}: Rehydrating unadvanced BYE match, advancing winner ${match.winnerId}`
          )
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

            const reports = await this.databaseManager.queryRows<any>(
              'SELECT * FROM "tournament_reports" WHERE "matchId" = $1',
              [match.id]
            )
            const r1Claimed = reports[0] ? (names.get(reports[0].claimedWinnerId) ?? 'Unknown') : 'Unknown'
            const r2Claimed = reports[1] ? (names.get(reports[1].claimedWinnerId) ?? 'Unknown') : 'Unknown'

            this.notifications
              .notifyDispute(tournament.bridgeId, match, p1Name, p2Name, r1Claimed, r2Claimed)
              .catch(() => {})
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
              this.logger?.warn(
                `Bracket message ${tournament.bracketMessageId} not found, will be re-created on next update`
              )
            }
          }
        } catch {
          // ignore
        }
      }
    }

    this.logger?.info('Tournament rehydration complete')
  }

  /**
   * Start the periodic deadline scheduler.
   */
  public startScheduler(): void {
    this.deadlineScheduler.start()
  }

  /**
   * Stop the periodic deadline scheduler.
   */
  public stopScheduler(): void {
    this.deadlineScheduler.stop()
  }

  /**
   * Register a handler for lifecycle broadcast events (wired to the web WS layer).
   */
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

  /**
   * Get an active tournament for a bridge. Only one active/signup tournament allowed per bridge.
   */
  public getActiveTournament(bridgeId: string): Tournament | undefined {
    return [...this.activeTournaments.values()].find((t) => t.bridgeId === bridgeId)
  }

  /**
   * Fetch a tournament by ID, from memory or database.
   */
  public async getTournament(id: number): Promise<Tournament | undefined> {
    const cached = this.activeTournaments.get(id)
    if (cached !== undefined) return cached

    return await this.databaseManager.queryOne<Tournament>('SELECT * FROM "tournaments" WHERE "id" = $1', [id])
  }

  /**
   * Create a new tournament.
   */
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
    const checkinClosesAt = startedAtUnix === undefined ? undefined : startedAtUnix

    this.logger.info(
      `createTournament: bridgeId=${bridgeId}, name="${name}", gameType="${gameType}", bestOf=${bestOf}, roundDeadlineHours=${roundDeadlineHours}, bracketFormat="${bracketFormat}", checkinWindowMinutes=${checkinWindowMinutes}`
    )

    const tournament = await this.databaseManager.queryOne<Tournament>(
      `INSERT INTO "tournaments" ("bridgeId", "name", "gameType", "bestOf", "status", "roundDeadlineHours", "createdBy", "createdAt", "checkinOpensAt", "checkinClosesAt", "startedAtUnix", "bracketFormat")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        bracketFormat
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

  /**
   * Open check-in manually for a tournament.
   */
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

  /**
   * Check in a player to a tournament.
   */
  public async checkinPlayer(tournamentId: number, playerUuid: string, discordId: string): Promise<TournamentPlayer> {
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
      'UPDATE "tournament_players" SET "checkedInAt" = $1, "status" = $2, "discordId" = $3 WHERE "id" = $4 RETURNING *',
      [now, PlayerStatus.CheckedIn, discordId, player.id]
    )

    if (updated === undefined) {
      throw new Error('Failed to check in player.')
    }

    this.logger.info(`Tournament ${tournamentId}: Player ${playerUuid} checked in successfully (playerId=${player.id})`)
    return updated
  }

  /**
   * Add a player to a tournament (Signup phase).
   */
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

    // Verify player is not already in the tournament
    const existing = await this.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
      [tournamentId, playerUuid]
    )
    if (existing !== undefined) {
      throw new Error('Player is already registered for this tournament.')
    }

    // Anti-abuse: rate-limit signups and flag potential alt accounts
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

    // Auto-checkin if check-in window is open
    if (tournament.checkinOpensAt !== undefined && now <= (tournament.checkinClosesAt ?? Infinity)) {
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

  /**
   * Remove a player from a tournament (Signup phase).
   */
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

    // During ACTIVE, only allow removal when the player is not in a live match —
    // otherwise they must be forfeited or substituted out first.
    if (tournament.status === TournamentStatus.Active) {
      const liveMatches = await this.databaseManager.queryRows<TournamentMatch>(
        `SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND ("player1Id" = $2 OR "player2Id" = $3) AND "status" IN ($4, $5, $6, $7)`,
        [
          tournamentId,
          player.id,
          player.id,
          MatchStatus.Active,
          MatchStatus.Reported,
          MatchStatus.Disputed,
          MatchStatus.BothConfirmed
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
    await this.auditLogger.log(tournamentId, 'player_removed', 'web-ui', undefined, playerUuid, {
      phase: tournament.status
    })
    this.logger.info(`Tournament ${tournamentId}: Player ${playerUuid} removed successfully`)
  }

  /**
   * Manually assign seeds during the signup phase.
   */
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

  /**
   * Edit signup-phase tournament settings.
   */
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

  /**
   * Reopen a cancelled tournament back into the signup phase.
   * Clears the generated bracket, results and channel references; registered players are kept.
   */
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

  /**
   * Start the tournament. Generates brackets, links matches, creates channels and threads.
   */
  public async startTournament(tournamentId: number, guildId: string, categoryId?: string): Promise<void> {
    const tournament = this.activeTournaments.get(tournamentId)
    if (tournament === undefined) {
      throw new Error('Tournament not found or not active.')
    }
    if (tournament.status !== TournamentStatus.Signup) {
      throw new Error('Tournament is already active.')
    }

    this.logger.info(
      `Tournament ${tournamentId} (${tournament.name}): Starting tournament for guild=${guildId}, categoryId=${categoryId ?? 'default'}`
    )

    // Fetch players
    const players = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )
    this.logger.info(`Tournament ${tournamentId}: Fetched ${players.length} total players`)

    // Filter to checked-in players
    const checkedIn = players.filter((p) => p.checkedInAt !== undefined)
    this.logger.info(`Tournament ${tournamentId}: ${checkedIn.length} players checked in`)
    const minParticipants = this.application.core.bridgeConfigurations.getTournamentMinParticipants(tournament.bridgeId)
    if (checkedIn.length < minParticipants) {
      throw new Error(`Not enough checked-in players. Minimum required: ${minParticipants}, got ${checkedIn.length}.`)
    }
    if (checkedIn.length < 2) {
      throw new Error('Not enough checked-in players to start.')
    }

    // Shuffle players randomly to assign seeds
    const shuffled = [...checkedIn]
    for (let index = shuffled.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
    }

    // Assign seed index (1-indexed)
    this.logger.info(`Tournament ${tournamentId}: Assigning seeds to ${shuffled.length} players`)
    for (const [index, element] of shuffled.entries()) {
      element.seed = index + 1
      await this.databaseManager.execute('UPDATE "tournament_players" SET "seed" = $1, "status" = $2 WHERE "id" = $3', [
        index + 1,
        PlayerStatus.Active,
        element.id
      ])
    }

    // Generate matches
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

    // Update tournament basic parameters
    const now = Math.floor(Date.now() / 1000)
    await this.databaseManager.execute(
      'UPDATE "tournaments" SET "status" = $1, "startedAt" = $2, "currentRound" = 1, "totalRounds" = $3 WHERE "id" = $4',
      [TournamentStatus.Active, now, totalRounds, tournamentId]
    )
    tournament.status = TournamentStatus.Active
    tournament.startedAt = now
    tournament.currentRound = 1
    tournament.totalRounds = totalRounds

    // Insert matches in reverse order to set nextMatchId database foreign keys
    const createdMatches: TournamentMatch[] = []
    const roundIndexToDatabaseIdMap = new Map<string, number>()

    this.logger.info(`Tournament ${tournamentId}: Inserting matches into database (reverse round order)`)

    await this.databaseManager.transaction(async (client) => {
      // Group generated matches by round
      const matchesByRound = new Map<number, GeneratedMatch[]>()
      for (const m of matches) {
        const list = matchesByRound.get(m.round!) ?? []
        list.push(m)
        matchesByRound.set(m.round!, list)
      }

      // Loop round-by-round from totalRounds down to 1
      for (let r = totalRounds; r >= 1; r--) {
        const roundList = matchesByRound.get(r) ?? []
        this.logger.info(`Tournament ${tournamentId}: Inserting ${roundList.length} matches for round ${r}`)
        for (const m of roundList) {
          let nextMatchId: number | undefined
          if (m.winnerNext !== undefined) {
            nextMatchId = roundIndexToDatabaseIdMap.get(`${m.winnerNext.round}_${m.winnerNext.matchIndex}`) ?? undefined
          }
          let loserNextMatchId: number | undefined
          if (m.loserNext !== undefined) {
            loserNextMatchId =
              roundIndexToDatabaseIdMap.get(`${m.loserNext.round}_${m.loserNext.matchIndex}`) ?? undefined
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
          roundIndexToDatabaseIdMap.set(`${r}_${m.matchIndex}`, databaseId)

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

    this.logger.info(`Tournament ${tournamentId}: All ${createdMatches.length} matches inserted successfully`)

    // Setup Discord channel for bracket
    const configCategoryId = this.application.core.bridgeConfigurations.getTournamentCategoryId(tournament.bridgeId)
    let resolvedCategoryId = categoryId ?? configCategoryId

    // Create tournament category + live channel if none configured
    if (tournament.categoryChannelId === undefined && resolvedCategoryId === undefined) {
      try {
        const createdCategoryId = await this.channelManager.createTournamentCategory(guildId, tournament.name)
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

          const liveChannelId = await this.channelManager.createLiveChannel(guildId, tournament.name, createdCategoryId)
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
    const channel = await this.channelManager.createBracketChannel(guildId, tournament.name, resolvedCategoryId)
    if (channel === undefined) {
      this.logger.info(`Tournament ${tournamentId}: Failed to create bracket channel`)
    } else {
      this.logger.info(`Tournament ${tournamentId}: Bracket channel created: #${channel.name} (${channel.id})`)
      await this.databaseManager.execute('UPDATE "tournaments" SET "discordChannelId" = $1 WHERE "id" = $2', [
        channel.id,
        tournamentId
      ])
      tournament.discordChannelId = channel.id

      // Send initial bracket message
      const names = await this.getPlayerNames(tournamentId)
      // Send an empty message, channelManager will update it
      const initialMessage = await channel.send({ content: 'Initializing bracket...' })
      this.logger.info(`Tournament ${tournamentId}: Initial bracket message sent (messageId=${initialMessage.id})`)
      await this.databaseManager.execute('UPDATE "tournaments" SET "bracketMessageId" = $1 WHERE "id" = $2', [
        initialMessage.id,
        tournamentId
      ])
      tournament.bracketMessageId = initialMessage.id

      // Update message with actual bracket
      await this.channelManager.updateBracketEmbed(
        channel.id,
        initialMessage.id,
        tournament,
        createdMatches,
        shuffled,
        names
      )

      // Spawn match threads for ACTIVE matches in round 1
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

          // Notify in whispers
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

      // Update message again to link thread channels
      this.logger.info(`Tournament ${tournamentId}: Updating bracket embed with thread links`)
      await this.channelManager.updateBracketEmbed(
        channel.id,
        initialMessage.id,
        tournament,
        createdMatches,
        shuffled,
        names
      )

      // Auto-resolve any BYE matches in Round 1 (this will advance winners into round 2)
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
    }

    this.logger.info(`Tournament ${tournamentId}: Tournament started successfully`)
    this.updateMetrics()
    this.emitEvent('tournament.started', { tournament })
  }

  /**
   * Cancel the tournament.
   */
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

    // Archive all active threads
    const activeMatches = await this.databaseManager.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "status" = $2',
      [tournamentId, MatchStatus.Active]
    )
    this.logger.info(`Tournament ${tournamentId}: Archiving ${activeMatches.length} active match threads`)

    for (const match of activeMatches) {
      if (match.discordThreadId !== undefined) {
        this.logger.info(`Match ${match.id}: Archiving thread ${match.discordThreadId}`)
        await this.channelManager.archiveMatchThread(match.discordThreadId, 'Tournament cancelled.')
      }
    }

    // Archive tournament category if present
    if (tournament.categoryChannelId !== undefined) {
      this.logger.info(`Tournament ${tournamentId}: Archiving tournament category ${tournament.categoryChannelId}`)
      await this.channelManager.archiveTournamentCategory(tournament)
    }

    this.updateMetrics()
    this.emitEvent('tournament.cancelled', { tournamentId })
  }

  async recordResults(tournamentId: number): Promise<TournamentResultRow[]> {
    // Read fresh from DB so champion/winnerId reflects the completed state
    const tournament = await this.databaseManager.queryOne<Tournament>('SELECT * FROM "tournaments" WHERE "id" = $1', [
      tournamentId
    ])
    if (tournament === undefined) {
      this.logger.info(`Tournament ${tournamentId}: recordResults called but tournament not found`)
      return []
    }

    this.logger.info(`Tournament ${tournamentId} (${tournament.name}): Recording results`)

    const players = await this.databaseManager.queryRows<any>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )

    const matches = await this.databaseManager.queryRows<any>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
      [tournamentId]
    )

    this.logger.info(
      `Tournament ${tournamentId}: Recording results for ${players.length} players from ${matches.length} matches`
    )

    await this.databaseManager.transaction(async (txClient) => {
      for (const player of players) {
        const playerMatches = matches.filter((m: any) => m.player1Id === player.id || m.player2Id === player.id)
        const wins = playerMatches.filter((m: any) => m.winnerId === player.id).length
        const losses = playerMatches.filter(
          (m: any) =>
            m.winnerId !== null && m.winnerId !== player.id && (m.player1Id === player.id || m.player2Id === player.id)
        ).length

        const isWinner = tournament.winnerId === player.id
        const roundsReached = isWinner
          ? (tournament.totalRounds ?? 1)
          : Math.max(...playerMatches.filter((m: any) => m.winnerId !== player.id).map((m: any) => m.round), 1)

        this.logger.info(
          `Tournament ${tournamentId}: Player ${player.playerUuid} — wins=${wins}, losses=${losses}, roundsReached=${roundsReached}, champion=${isWinner}`
        )

        await txClient.query(
          `INSERT INTO "tournament_results" ("playerUuid", "discordId", "tournamentId", "placement", "roundsReached", "wins", "losses", "champion")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            player.playerUuid,
            player.discordId,
            tournamentId,
            isWinner ? 1 : (tournament.totalRounds ?? 1) - roundsReached + 2,
            roundsReached,
            wins,
            losses,
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

  /**
   * Finalize a completed tournament: record results, announce standings, refresh metrics and notify WS subscribers.
   */
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

  /**
   * Rewind a completed match back to ACTIVE, undoing reports, player elimination and winner advancement.
   */
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
      // 1. Undo tournament-level completion state
      if (tournament.status === TournamentStatus.Completed) {
        await database.query(
          'UPDATE "tournaments" SET "status" = $1, "winnerId" = NULL, "completedAt" = NULL WHERE "id" = $2',
          [TournamentStatus.Active, tournament.id]
        )
        // Drop previously recorded results so re-completing does not duplicate them
        await database.query('DELETE FROM "tournament_results" WHERE "tournamentId" = $1', [tournament.id])
      }
      if (tournament.currentRound > match.round) {
        await database.query('UPDATE "tournaments" SET "currentRound" = $1 WHERE "id" = $2', [
          match.round,
          tournament.id
        ])
      }

      // 2. Reset the match itself
      await database.query(
        'UPDATE "tournament_matches" SET "status" = $1, "winnerId" = NULL, "completedAt" = NULL, "player1Wins" = 0, "player2Wins" = 0, "deadlineAt" = $2, "manuallyExtended" = FALSE, "deadlineExtensionMinutes" = 0, "warningsSent" = 0, "hadProofAttachment" = FALSE WHERE "id" = $3',
        [MatchStatus.Active, now + tournament.roundDeadlineHours * 3600, matchId]
      )

      // 3. Drop reports for the match
      await database.query('DELETE FROM "tournament_reports" WHERE "matchId" = $1', [matchId])

      // 4. Restore both players to ACTIVE
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

      // 5. Undo advancement into the next match(es): the winner fills
      //    `nextMatchId`, while in double-elim the loser fills `loserNextMatchId`.
      //    Clear whichever slot actually holds the advanced player.
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

    // 6. Delete threads of demoted next matches (outside the transaction)
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

    // 7. Reopen the match's own thread if it was archived/locked
    if (match.discordThreadId !== undefined) {
      const thread = await client.channels.fetch(match.discordThreadId).catch(() => null)
      if (thread != null && (thread.type === ChannelType.PrivateThread || thread.type === ChannelType.PublicThread)) {
        await thread.setLocked(false).catch(() => undefined)
        await thread.setArchived(false).catch(() => undefined)
      }
    }

    // 8. Audit log
    await this.auditLogger.log(tournament.id, 'match_undo', actorDiscordId ?? 'system', matchId, undefined, {
      round: match.round,
      matchIndex: match.matchIndex,
      winnerId
    })

    // 9. Refresh bracket embed
    if (tournament.discordChannelId !== undefined && tournament.bracketMessageId !== undefined) {
      await this.refreshBracketEmbed(tournament)
    }

    // 10. Keep in-memory state consistent
    const cached = this.activeTournaments.get(tournament.id)
    if (cached !== undefined) {
      cached.status = TournamentStatus.Active
      cached.winnerId = undefined
      cached.completedAt = undefined
      if (cached.currentRound > match.round) {
        cached.currentRound = match.round
      }
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
    await this.channelManager.updateBracketEmbed(
      tournament.discordChannelId,
      tournament.bracketMessageId,
      tournament,
      matches,
      players,
      names
    )
  }

  async getAllTournaments(): Promise<any[]> {
    return await this.databaseManager.queryRows<any>('SELECT * FROM "tournaments" ORDER BY "createdAt" DESC')
  }

  async getMatches(tournamentId: number): Promise<any[]> {
    return await this.databaseManager.queryRows<any>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 ORDER BY "round", "matchIndex"',
      [tournamentId]
    )
  }

  async getPlayers(tournamentId: number): Promise<any[]> {
    return await this.databaseManager.queryRows<any>('SELECT * FROM "tournament_players" WHERE "tournamentId" = $1', [
      tournamentId
    ])
  }

  /**
   * Resolves player IDs to Minecraft usernames.
   */
  public async getPlayerNames(tournamentId: number): Promise<Map<number, string>> {
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

    return map
  }
}
