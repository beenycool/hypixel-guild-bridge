/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/require-await */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type Application from '../src/application.js'
import type { DatabaseManager } from '../src/common/database-manager.js'
import { type TournamentBroadcastEvent, TournamentManager } from '../src/core/tournament/tournament-manager.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from '../src/core/tournament/types.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from '../src/core/tournament/types.js'

interface QueryResult {
  rows?: unknown[]
  rowCount?: number
}

const QueryMock = mock.fn<(sql: string, values: unknown[]) => Promise<QueryResult>>()
const QueryOneMock = mock.fn<(sql: string, values: unknown[]) => Promise<unknown>>()
const QueryRowsMock = mock.fn<(sql: string, values: unknown[]) => Promise<unknown[]>>()
const ExecuteMock = mock.fn<(sql: string, values: unknown[]) => Promise<number>>()
const TransactionMock = mock.fn<(callback: (database: unknown) => Promise<unknown>) => Promise<unknown>>()

const MockDatabase = {
  query: QueryMock,
  queryOne: QueryOneMock,
  queryRows: QueryRowsMock,
  execute: ExecuteMock,
  transaction: TransactionMock
} as unknown as DatabaseManager

function buildMockApplication(): Application {
  return {
    logger: {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
      debug: mock.fn(),
      trace: mock.fn()
    },
    core: {
      bridgeConfigurations: {
        getTournamentCategoryId: () => undefined,
        getTournamentNotificationChannelId: () => undefined,
        getTournamentDefaultBracketFormat: () => 'single-elim',
        getTournamentMinParticipants: () => 2,
        getPublicChannelIds: () => [],
        getOfficerChannelIds: () => [],
        getLoggerChannelIds: () => [],
        getPromoteChannelIds: () => []
      }
    },
    discordInstance: {
      getClient: () => ({
        channels: { fetch: () => Promise.resolve(undefined) },
        guilds: { fetch: () => Promise.resolve(undefined) }
      })
    },
    mojangApi: {
      profileByUuid: () => Promise.resolve(undefined)
    },
    metrics: undefined
  } as unknown as Application
}

function buildTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1,
    bridgeId: 'bridge-1',
    name: 'Test Tournament',
    gameType: 'bedwars',
    bestOf: 3,
    status: TournamentStatus.Completed,
    roundDeadlineHours: 48,
    createdBy: 'system',
    winnerId: 100,
    discordChannelId: undefined,
    bracketMessageId: undefined,
    categoryChannelId: undefined,
    liveChannelId: undefined,
    checkinOpensAt: undefined,
    checkinClosesAt: undefined,
    startedAtUnix: undefined,
    currentRound: 3,
    totalRounds: 3,
    createdAt: 0,
    startedAt: 0,
    completedAt: 0,
    ...overrides
  }
}

function buildMatch(overrides: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 5,
    tournamentId: 1,
    round: 2,
    matchIndex: 0,
    player1Id: 100,
    player2Id: 200,
    winnerId: 100,
    nextMatchId: 9,
    status: MatchStatus.Completed,
    player1Wins: 2,
    player2Wins: 0,
    discordThreadId: 'thread-5',
    deadlineAt: 0,
    warningsSent: 0,
    completedAt: 0,
    deadlineExtensionMinutes: 0,
    manuallyExtended: false,
    hadProofAttachment: false,
    ...overrides
  }
}

function buildRegisteredPlayer(): TournamentPlayer {
  return {
    id: 1,
    tournamentId: 1,
    playerUuid: 'uuid-1',
    discordId: 'discord-1',
    seed: 0,
    status: PlayerStatus.Registered,
    joinedAt: 0,
    checkedInAt: undefined
  }
}

function resetMocks(): void {
  QueryMock.mock.resetCalls()
  QueryOneMock.mock.resetCalls()
  QueryRowsMock.mock.resetCalls()
  ExecuteMock.mock.resetCalls()
  TransactionMock.mock.resetCalls()
  TransactionMock.mock.mockImplementation(async (callback: (database: unknown) => Promise<unknown>) => {
    return await callback(MockDatabase)
  })
}

function buildCheckedInPlayers(): TournamentPlayer[] {
  return Array.from({ length: 4 }, (element, index) => {
    void element
    return {
      id: index + 1,
      tournamentId: 1,
      playerUuid: `uuid-${index + 1}`,
      discordId: undefined,
      seed: 0,
      status: PlayerStatus.Registered,
      joinedAt: 0,
      checkedInAt: 1
    }
  })
}

function mockSignupFlow(
  tournament: Tournament,
  players: TournamentPlayer[]
): { inserts: { sql: string; values: unknown[] }[] } {
  const inserts: { sql: string; values: unknown[] }[] = []
  let nextId = 1
  QueryOneMock.mock.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO "tournaments"')) return tournament
    return
  })
  QueryRowsMock.mock.mockImplementation(async (sql: string) => {
    if (sql.includes('"tournament_players"')) return players
    return []
  })
  QueryMock.mock.mockImplementation(async (sql: string, values: unknown[]): Promise<QueryResult> => {
    if (sql.includes('INSERT INTO "tournament_matches"')) {
      inserts.push({ sql, values })
      return { rows: [{ id: nextId++ }] }
    }
    return { rows: [] }
  })
  return { inserts }
}

describe('TournamentManager', () => {
  it('should create a tournament', async () => {
    QueryMock.mock.mockImplementation(async (): Promise<QueryResult> => {
      return { rows: [{ id: 1 }] }
    })

    const result = await QueryMock('INSERT INTO tournaments ...', [])
    const row = result.rows?.[0] as { id: number } | undefined
    assert.equal(row?.id, 1)
  })

  it('should add a player to a tournament', async () => {
    QueryMock.mock.mockImplementation(async (): Promise<QueryResult> => {
      return { rows: [{ id: 1 }] }
    })

    const result = await QueryMock('INSERT INTO tournament_players ...', [])
    const row = result.rows?.[0] as { id: number } | undefined
    assert.equal(row?.id, 1)
  })

  it('should reject duplicate player join', async () => {
    QueryMock.mock.mockImplementation(async (): Promise<QueryResult> => {
      throw new Error('duplicate key value violates unique constraint')
    })

    await assert.rejects(async () => await QueryMock('INSERT INTO tournament_players ...', []), /duplicate/)
  })

  it('should handle player leave', async () => {
    let deleted = false
    QueryMock.mock.mockImplementation(async (sql: string): Promise<QueryResult> => {
      if (sql.includes('DELETE')) {
        deleted = true
        return { rowCount: 1 }
      }
      return { rows: [] }
    })

    await QueryMock('DELETE FROM tournament_players WHERE tournament_id = $1 AND player_uuid = $2', [1, 'uuid'])
    assert.equal(deleted, true)
  })

  describe('anti-abuse wiring', () => {
    it('rejects addPlayer when the player shares an IP with an existing participant', async () => {
      resetMocks()
      const tournament = buildTournament({ status: TournamentStatus.Signup, winnerId: undefined })
      QueryOneMock.mock.mockImplementation(async (sql: string) => {
        if (sql.includes('"tournaments"')) return tournament
        return
      })
      QueryRowsMock.mock.mockImplementation(async (sql: string) => {
        if (sql.includes('"tournament_players"')) return []
        if (sql.includes('mojang')) {
          const row = (playerUuid: string, ip: string): Record<string, string> => ({ ['player_uuid']: playerUuid, ip })
          return [row('uuid-existing', '1.2.3.4'), row('uuid-new', '1.2.3.4')]
        }
        return []
      })

      const manager = new TournamentManager(MockDatabase, buildMockApplication())
      await manager.createTournament('bridge-1', 'Test Tournament', 'bedwars', 3, 'system')

      await assert.rejects(
        async () => await manager.addPlayer(1, 'uuid-new', 'discord-new'),
        /FLAGGED: Potential alt account/
      )
    })

    it('rejects addPlayer when the user joins/leaves too fast', async () => {
      resetMocks()
      const tournament = buildTournament({ status: TournamentStatus.Signup, winnerId: undefined })
      QueryOneMock.mock.mockImplementation(async (sql: string) => {
        if (sql.includes('"tournaments"')) return tournament
        if (sql.includes('INSERT INTO "tournament_players"')) return buildRegisteredPlayer()
        return
      })
      QueryRowsMock.mock.mockImplementation(async () => [])

      const manager = new TournamentManager(MockDatabase, buildMockApplication())
      await manager.createTournament('bridge-1', 'Test Tournament', 'bedwars', 3, 'system')

      await manager.addPlayer(1, 'uuid-1', 'discord-fast')
      await assert.rejects(async () => await manager.addPlayer(1, 'uuid-2', 'discord-fast'), /too fast/)
    })
  })

  describe('notifyTournamentCompleted', () => {
    it('records results, announces standings, updates metrics and emits tournament.completed', async () => {
      resetMocks()
      const tournament = buildTournament()
      const players: TournamentPlayer[] = [
        {
          id: 100,
          tournamentId: 1,
          playerUuid: 'uuid-100',
          discordId: 'discord-100',
          seed: 1,
          status: PlayerStatus.Winner,
          joinedAt: 0,
          checkedInAt: 0
        },
        {
          id: 200,
          tournamentId: 1,
          playerUuid: 'uuid-200',
          discordId: 'discord-200',
          seed: 2,
          status: PlayerStatus.Eliminated,
          joinedAt: 0,
          checkedInAt: 0
        }
      ]
      const matches: TournamentMatch[] = [
        buildMatch({ id: 1, round: 1, matchIndex: 0, player1Id: 100, player2Id: 200, winnerId: 100, nextMatchId: 2 }),
        buildMatch({
          id: 2,
          round: 2,
          matchIndex: 0,
          player1Id: 100,
          player2Id: undefined,
          winnerId: 100,
          nextMatchId: undefined
        })
      ]
      const resultRows = [
        {
          id: 1,
          playerUuid: 'uuid-100',
          discordId: 'discord-100',
          tournamentId: 1,
          placement: 1,
          roundsReached: 3,
          wins: 2,
          losses: 0,
          champion: true,
          createdAt: 0
        },
        {
          id: 2,
          playerUuid: 'uuid-200',
          discordId: 'discord-200',
          tournamentId: 1,
          placement: 2,
          roundsReached: 1,
          wins: 0,
          losses: 1,
          champion: false,
          createdAt: 0
        }
      ]

      QueryOneMock.mock.mockImplementation(async (sql: string) => {
        if (sql.includes('"tournaments"')) return tournament
        return
      })
      QueryRowsMock.mock.mockImplementation(async (sql: string) => {
        if (sql.includes('"tournament_players"')) return players
        if (sql.includes('"tournament_matches"')) return matches
        if (sql.includes('"tournament_results"')) return resultRows
        return []
      })

      const inserted: unknown[][] = []
      QueryMock.mock.mockImplementation(async (sql: string, values: unknown[]): Promise<QueryResult> => {
        inserted.push(values)
        return { rows: [] }
      })

      const events: TournamentBroadcastEvent[] = []
      const manager = new TournamentManager(MockDatabase, buildMockApplication())
      manager.onEvent((event) => {
        events.push(event)
      })

      const results = await manager.recordResults(1)
      assert.equal(inserted.length, 2)
      assert.equal(results.length, 2)
      assert.equal(results[0].placement, 1)

      await manager.notifyTournamentCompleted(1)
      assert.ok(events.some((event) => event.type === 'tournament.completed'))
    })
  })

  describe('rewindMatch', () => {
    it('rolls back the match, tournament, reports, player statuses and next-match advancement', async () => {
      resetMocks()
      const tournament = buildTournament()
      const nextMatch = buildMatch({
        id: 9,
        round: 3,
        matchIndex: 0,
        player1Id: 100,
        player2Id: 300,
        winnerId: undefined,
        nextMatchId: undefined,
        status: MatchStatus.Active,
        discordThreadId: 'thread-9'
      })
      const loserNextMatch = buildMatch({
        id: 10,
        round: 3,
        matchIndex: 1,
        player1Id: 400,
        player2Id: 200,
        winnerId: undefined,
        nextMatchId: undefined,
        status: MatchStatus.Active,
        discordThreadId: 'thread-10'
      })
      const rewoundMatch = buildMatch({ loserNextMatchId: 10 })

      QueryOneMock.mock.mockImplementation(async (sql: string, values: unknown[]) => {
        if (sql.includes('"tournament_matches"')) {
          if (values[0] === 5) return rewoundMatch
          return values[0] === 9 ? nextMatch : loserNextMatch
        }
        if (sql.includes('"tournaments"')) return tournament
        return
      })
      QueryRowsMock.mock.mockImplementation(async () => [])

      const executed: { sql: string; values: unknown[] }[] = []
      ExecuteMock.mock.mockImplementation(async (sql: string, values: unknown[]) => {
        executed.push({ sql, values })
        return 1
      })
      QueryMock.mock.mockImplementation(async (sql: string, values: unknown[]): Promise<QueryResult> => {
        executed.push({ sql, values })
        return { rows: [] }
      })

      const events: TournamentBroadcastEvent[] = []
      const manager = new TournamentManager(MockDatabase, buildMockApplication())
      manager.onEvent((event) => {
        events.push(event)
      })

      await manager.rewindMatch(5, 'discord-admin')

      assert.ok(
        executed.some((entry) =>
          entry.sql.includes('UPDATE "tournaments" SET "status" = $1, "winnerId" = NULL, "completedAt" = NULL')
        ),
        'tournament completion state should be reset'
      )
      assert.ok(
        executed.some((entry) => entry.sql.includes('UPDATE "tournaments" SET "currentRound" = $1')),
        'currentRound should be rolled back'
      )
      const matchReset = executed.find((entry) => entry.sql.includes('UPDATE "tournament_matches" SET "status" = $1'))
      assert.ok(matchReset !== undefined, 'match should be reset to ACTIVE')
      assert.equal(matchReset.values[0], MatchStatus.Active)
      assert.ok(
        matchReset.sql.includes('"player1Wins" = 0') && matchReset.sql.includes('"manuallyExtended" = FALSE'),
        'match score/extensions should be reset'
      )
      assert.ok(
        executed.some((entry) => entry.sql.includes('DELETE FROM "tournament_reports" WHERE "matchId" = $1')),
        'reports should be deleted'
      )
      const playerRestores = executed.filter((entry) =>
        entry.sql.includes('UPDATE "tournament_players" SET "status" = $1')
      )
      assert.equal(playerRestores.length, 2, 'winner and loser should both be restored to ACTIVE')
      assert.ok(
        executed.some((entry) => entry.sql.includes('UPDATE "tournament_matches" SET "player1Id" = NULL')),
        'next match slot should be cleared'
      )
      assert.ok(
        executed.some((entry) => entry.sql.includes('UPDATE "tournament_matches" SET "player2Id" = NULL')),
        'loser-bracket next match slot should be cleared'
      )
      assert.ok(
        executed.some((entry) => entry.sql.includes('DELETE FROM "tournament_results"')),
        'stale tournament results should be purged when un-completing'
      )
      assert.ok(
        executed.some((entry) => entry.sql.includes('"status" = $1, "deadlineAt" = NULL')),
        'next match should be set back to PENDING'
      )
      assert.ok(
        executed.some((entry) => entry.sql.includes('INSERT INTO "tournament_audit_log"')),
        'audit log entry should be written'
      )
      assert.ok(
        events.some((event) => event.type === 'tournament.undo'),
        'tournament.undo should be broadcast'
      )
    })

    it('rejects rewinding a match that is not completed', async () => {
      resetMocks()
      const match = buildMatch({ status: MatchStatus.Active, winnerId: undefined })
      QueryOneMock.mock.mockImplementation(async (sql: string, values: unknown[]) => {
        if (sql.includes('"tournament_matches"')) return values[0] === 5 ? match : undefined
        return
      })

      const manager = new TournamentManager(MockDatabase, buildMockApplication())
      await assert.rejects(async () => {
        await manager.rewindMatch(5)
      }, /not completed/)
    })
  })

  describe('startTournament', () => {
    it('generates with the tournament bracket format and inserts loserNextMatchId links', async () => {
      resetMocks()
      const tournament = buildTournament({
        status: TournamentStatus.Signup,
        winnerId: undefined,
        bracketFormat: 'double-elim'
      })
      const { inserts } = mockSignupFlow(tournament, buildCheckedInPlayers())

      const manager = new TournamentManager(MockDatabase, buildMockApplication())
      await manager.createTournament(
        'bridge-1',
        'Test Tournament',
        'bedwars',
        3,
        'system',
        48,
        undefined,
        60,
        'double-elim'
      )
      await manager.startTournament(1, 'guild-1')

      assert.strictEqual(inserts.length, 6, 'double-elim for 4 players should insert 6 matches')
      for (const insert of inserts) {
        assert.ok(insert.sql.includes('"loserNextMatchId"'), 'insert must include loserNextMatchId column')
      }
      const round1 = inserts.filter((insert) => insert.values[1] === 1)
      assert.strictEqual(round1.length, 2)
      for (const insert of round1) {
        assert.strictEqual(insert.values[7], 3, 'round-1 loserNextMatchId should point to the LB round match')
        assert.strictEqual(insert.values[6], 4, 'round-1 nextMatchId should point to the UB round-2 match')
      }
    })

    it('falls back to the configured default bracket format when the tournament row has none', async () => {
      resetMocks()
      const tournament = buildTournament({ status: TournamentStatus.Signup, winnerId: undefined })
      const { inserts } = mockSignupFlow(tournament, buildCheckedInPlayers())
      const application = buildMockApplication()
      application.core.bridgeConfigurations.getTournamentDefaultBracketFormat = () => 'round-robin'

      const manager = new TournamentManager(MockDatabase, application)
      await manager.createTournament('bridge-1', 'Test Tournament', 'bedwars', 3, 'system')
      await manager.startTournament(1, 'guild-1')

      assert.strictEqual(inserts.length, 6, 'round-robin for 4 players should insert 6 matches')
      for (const insert of inserts) {
        assert.strictEqual(insert.values[1], 1, 'round-robin matches are all in round 1')
        // eslint-disable-next-line unicorn/no-null -- SQL NULL sentinel for 'no next match'
        assert.strictEqual(insert.values[6], null, 'round-robin matches have no nextMatchId')
        // eslint-disable-next-line unicorn/no-null -- SQL NULL sentinel for 'no loser next match'
        assert.strictEqual(insert.values[7], null, 'round-robin matches have no loserNextMatchId')
      }
    })
  })
})
