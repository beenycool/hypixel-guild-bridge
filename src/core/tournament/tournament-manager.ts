/* eslint-disable unicorn/no-null */
import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type { DatabaseManager } from '../../common/database-manager.js'

import { BracketGenerator } from './bracket-generator.js'
import { DeadlineScheduler } from './deadline-scheduler.js'
import { MatchManager } from './match-manager.js'
import { TournamentChannelManager } from './tournament-channel-manager.js'
import { TournamentNotifications } from './tournament-notifications.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from './types.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from './types.js'
import { AuditLogger } from './audit-logger.js'
import { AntiAbuse } from './anti-abuse.js'

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

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly application: Application
  ) {
    this.logger = application.logger
    this.bracketGenerator = new BracketGenerator()
    this.channelManager = new TournamentChannelManager(application)
    this.notifications = new TournamentNotifications(application)
    this.auditLogger = new AuditLogger(this.databaseManager, this.logger)
    this.antiAbuse = new AntiAbuse(this.databaseManager)

    // Bind helpers to match manager
    this.matchManager = new MatchManager(
      databaseManager,
      this.channelManager,
      this.notifications,
      async (id) => await this.getTournament(id),
      async (id) => await this.getPlayerNames(id),
      async (threadId) => await this.channelManager.checkProofAttachment(threadId),
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
    }
    this.logger.info(`Loaded ${this.activeTournaments.size} active tournaments from database.`)
  }

  async rehydrate(): Promise<void> {
    this.logger?.info('Rehydrating tournament state from database...')

    for (const [id, tournament] of this.activeTournaments) {
      if (tournament.status !== TournamentStatus.Active && tournament.status !== TournamentStatus.Signup) continue

      const matches = await this.databaseManager.queryRows<any>(
        'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 ORDER BY "round", "matchIndex"',
        [id]
      )

      for (const match of matches) {
        if (match.status === MatchStatus.Active || match.status === MatchStatus.Reported) {
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

        if (match.status === MatchStatus.Disputed && match.deadlineAt) {
          const now = Math.floor(Date.now() / 1000)
          if (now > match.deadlineAt) {
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
    checkinWindowMinutes = 60
  ): Promise<Tournament> {
    const existing = this.getActiveTournament(bridgeId)
    if (existing !== undefined) {
      throw new Error(`An active tournament already exists for this bridge: "${existing.name}"`)
    }

    const now = Math.floor(Date.now() / 1000)

    const checkinOpensAt = startedAtUnix !== undefined ? startedAtUnix - checkinWindowMinutes * 60 : undefined
    const checkinClosesAt = startedAtUnix !== undefined ? startedAtUnix : undefined

    const tournament = await this.databaseManager.queryOne<Tournament>(
      `INSERT INTO "tournaments" ("bridgeId", "name", "gameType", "bestOf", "status", "roundDeadlineHours", "createdBy", "createdAt", "checkinOpensAt", "checkinClosesAt", "startedAtUnix")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        startedAtUnix ?? null
      ]
    )

    if (tournament === undefined) {
      throw new Error('Failed to insert tournament into database.')
    }

    this.activeTournaments.set(tournament.id, tournament)
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

    // Verify player is not already in the tournament
    const existing = await this.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
      [tournamentId, playerUuid]
    )
    if (existing !== undefined) {
      throw new Error('Player is already registered for this tournament.')
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
    if (tournament.status !== TournamentStatus.Signup) {
      throw new Error('Tournament has already started.')
    }

    const affected = await this.databaseManager.execute(
      'DELETE FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
      [tournamentId, playerUuid]
    )

    if (affected === 0) {
      throw new Error('Player is not registered for this tournament.')
    }
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

    // Fetch players
    const players = await this.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )

    // Filter to checked-in players
    const checkedIn = players.filter((p) => p.checkedInAt !== undefined)
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
    for (const [index, element] of shuffled.entries()) {
      element.seed = index + 1
      await this.databaseManager.execute('UPDATE "tournament_players" SET "seed" = $1, "status" = $2 WHERE "id" = $3', [
        index + 1,
        PlayerStatus.Active,
        element.id
      ])
    }

    // Generate matches
    const { totalRounds, matches } = this.bracketGenerator.generateInitialMatches(
      tournamentId,
      shuffled,
      tournament.roundDeadlineHours
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

    await this.databaseManager.transaction(async (client) => {
      // Group generated matches by round
      const matchesByRound = new Map<number, Omit<TournamentMatch, 'id' | 'nextMatchId'>[]>()
      for (const m of matches) {
        const list = matchesByRound.get(m.round) ?? []
        list.push(m)
        matchesByRound.set(m.round, list)
      }

      // Loop round-by-round from totalRounds down to 1
      for (let r = totalRounds; r >= 1; r--) {
        const roundList = matchesByRound.get(r) ?? []
        for (const m of roundList) {
          let nextMatchId: number | undefined

          if (r < totalRounds) {
            const nextRound = r + 1
            const nextIndex = Math.floor(m.matchIndex / 2)
            nextMatchId = roundIndexToDatabaseIdMap.get(`${nextRound}_${nextIndex}`) ?? undefined
          }

          const result = await client.query<{ id: number }>(
            `INSERT INTO "tournament_matches"
               ("tournamentId", "round", "matchIndex", "player1Id", "player2Id", "winnerId", "nextMatchId", "status", "player1Wins", "player2Wins", "deadlineAt", "completedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING "id"`,
            [
              m.tournamentId,
              m.round,
              m.matchIndex,
              m.player1Id ?? null,
              m.player2Id ?? null,
              m.winnerId ?? null,
              nextMatchId ?? null,
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
            ...m,
            nextMatchId
          } as TournamentMatch)
        }
      }
    })

    // Setup Discord channel for bracket
    const configCategoryId = this.application.core.bridgeConfigurations.getTournamentCategoryId(tournament.bridgeId)
    const resolvedCategoryId = categoryId ?? configCategoryId
    const channel = await this.channelManager.createBracketChannel(guildId, tournament.name, resolvedCategoryId)
    if (channel !== undefined) {
      await this.databaseManager.execute('UPDATE "tournaments" SET "discordChannelId" = $1 WHERE "id" = $2', [
        channel.id,
        tournamentId
      ])
      tournament.discordChannelId = channel.id

      // Send initial bracket message
      const names = await this.getPlayerNames(tournamentId)
      // Send an empty message, channelManager will update it
      const initialMessage = await channel.send({ content: 'Initializing bracket...' })
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
      for (const m of activeRound1) {
        const p1 = shuffled.find((p) => p.id === m.player1Id)
        const p2 = shuffled.find((p) => p.id === m.player2Id)

        if (p1 !== undefined && p2 !== undefined) {
          const p1Name = names.get(p1.id) ?? 'Player 1'
          const p2Name = names.get(p2.id) ?? 'Player 2'

          const threadId = await this.channelManager.createMatchThread(channel.id, m, p1, p2, p1Name, p2Name)

          if (threadId !== undefined) {
            await this.databaseManager.execute(
              'UPDATE "tournament_matches" SET "discordThreadId" = $1 WHERE "id" = $2',
              [threadId, m.id]
            )
            m.discordThreadId = threadId
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
      await this.channelManager.updateBracketEmbed(
        channel.id,
        initialMessage.id,
        tournament,
        createdMatches,
        shuffled,
        names
      )

      // Auto-resolve any BYE matches in Round 1 (this will recursively advance players)
      const byeRound1 = createdMatches.filter((m) => m.round === 1 && m.status === MatchStatus.Bye)
      for (const m of byeRound1) {
        if (m.winnerId !== undefined) {
          await this.matchManager.adminConfirm(m.id, m.winnerId).catch((error: unknown) => {
            this.logger.error(`Error resolving BYE match ${m.id}:`, error)
          })
        }
      }
    }
  }

  /**
   * Cancel the tournament.
   */
  public async cancelTournament(tournamentId: number): Promise<void> {
    const tournament = await this.getTournament(tournamentId)
    if (tournament === undefined) return

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

    for (const match of activeMatches) {
      if (match.discordThreadId !== undefined) {
        await this.channelManager.archiveMatchThread(match.discordThreadId, 'Tournament cancelled.')
      }
    }

    // Archive tournament category if present
    if (tournament.categoryChannelId !== undefined) {
      await this.channelManager.archiveTournamentCategory(tournament)
    }
  }

  async recordResults(tournamentId: number): Promise<void> {
    const tournament = await this.getTournament(tournamentId)
    if (!tournament) return

    const players = await this.databaseManager.queryRows<any>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournamentId]
    )

    const matches = await this.databaseManager.queryRows<any>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
      [tournamentId]
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
  }

  private updateMetrics(): void {
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
      const profile = await this.application.mojangApi.profileByUuid(p.playerUuid).catch(() => undefined)
      map.set(p.id, profile?.name ?? `Player #${p.id}`)
    }

    return map
  }
}
