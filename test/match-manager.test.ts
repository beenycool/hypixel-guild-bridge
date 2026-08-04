/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/require-await */
import assert from 'node:assert'
import { describe, it, mock, type Mock } from 'node:test'

import type { DatabaseManager } from '../src/common/database-manager.js'
import type { AbuseCheckResult, AntiAbuse } from '../src/core/tournament/anti-abuse.js'
import { BracketGenerator } from '../src/core/tournament/bracket-generator.js'
import { MatchManager } from '../src/core/tournament/match-manager.js'
import { validateSeriesScore } from '../src/core/tournament/score-validator.js'
import type { TournamentChannelManager } from '../src/core/tournament/tournament-channel-manager.js'
import type { TournamentNotifications } from '../src/core/tournament/tournament-notifications.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from '../src/core/tournament/types.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from '../src/core/tournament/types.js'

function getForfeitWinner(forfeitingId: number, p1Id: number, p2Id: number): number {
  return forfeitingId === p1Id ? p2Id : p1Id
}

function buildMatch(overrides: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 1,
    tournamentId: 1,
    round: 1,
    matchIndex: 0,
    player1Id: 100,
    player2Id: 200,
    winnerId: undefined,
    nextMatchId: undefined,
    status: MatchStatus.Active,
    player1Wins: 0,
    player2Wins: 0,
    discordThreadId: undefined,
    deadlineAt: 0,
    warningsSent: 0,
    completedAt: undefined,
    deadlineExtensionMinutes: 0,
    manuallyExtended: false,
    hadProofAttachment: false,
    ...overrides
  }
}

function buildTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1,
    bridgeId: 'bridge-1',
    name: 'Test Tournament',
    gameType: 'bedwars',
    bestOf: 3,
    status: TournamentStatus.Active,
    roundDeadlineHours: 48,
    createdBy: 'system',
    winnerId: undefined,
    discordChannelId: undefined,
    bracketMessageId: undefined,
    categoryChannelId: undefined,
    liveChannelId: undefined,
    checkinOpensAt: undefined,
    checkinClosesAt: undefined,
    startedAtUnix: undefined,
    currentRound: 1,
    totalRounds: 1,
    bracketFormat: 'single-elim',
    createdAt: 0,
    startedAt: 0,
    completedAt: undefined,
    ...overrides
  }
}

function buildPlayer(id: number, playerUuid: string, discordId: string | undefined): TournamentPlayer {
  return {
    id,
    tournamentId: 1,
    playerUuid,
    discordId,
    seed: id,
    status: PlayerStatus.Active,
    joinedAt: 0,
    checkedInAt: 0
  }
}

interface MatchManagerHarness {
  manager: MatchManager
  executed: { sql: string; values: unknown[] }[]
  notificationsCalled: { name: string; args: unknown[] }[]
}

function buildHarness(
  tournament: Tournament,
  matches: TournamentMatch[],
  players: TournamentPlayer[]
): MatchManagerHarness {
  const executed: { sql: string; values: unknown[] }[] = []
  const notificationsCalled: { name: string; args: unknown[] }[] = []

  const queryOne = mock.fn<(sql: string, values: unknown[]) => Promise<unknown>>()
  const queryRows = mock.fn<(sql: string, values: unknown[]) => Promise<unknown[]>>()
  queryOne.mock.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes('"tournament_matches"')) return matches.find((m) => m.id === values[0])
    if (sql.includes('"tournament_players"')) return players.find((p) => p.id === values[0])
    return
  })
  queryRows.mock.mockImplementation(async (sql: string) => {
    if (sql.includes('"tournament_matches"')) return matches
    if (sql.includes('"tournament_players"')) return players
    return []
  })

  const execute = mock.fn<(sql: string, values: unknown[]) => Promise<number>>()
  execute.mock.mockImplementation(async (sql: string, values: unknown[]) => {
    executed.push({ sql, values })
    if (sql.includes('UPDATE "tournament_matches" SET "status" = $1, "winnerId" = $2, "completedAt" = $3')) {
      const match = matches.find((m) => m.id === values.at(-1))
      if (match !== undefined) {
        match.status = values[0] as MatchStatus
        match.winnerId = values[1] as number
        match.completedAt = values[2] as number
      }
    }
    if (sql.includes('UPDATE "tournament_matches" SET "player1Id"')) {
      const match = matches.find((m) => m.id === values[1])
      if (match !== undefined) match.player1Id = values[0] as number
    }
    if (sql.includes('UPDATE "tournament_matches" SET "player2Id"')) {
      const match = matches.find((m) => m.id === values[1])
      if (match !== undefined) match.player2Id = values[0] as number
    }
    if (sql.includes('UPDATE "tournament_matches" SET "discordThreadId"')) {
      const match = matches.find((m) => m.id === values[1])
      if (match !== undefined) match.discordThreadId = values[0] as string
    }
    return 1
  })

  const databaseManager = {
    query: mock.fn(),
    queryOne,
    queryRows,
    execute,
    transaction: mock.fn(async (callback: (database: unknown) => Promise<unknown>) => {
      return await callback(databaseManager)
    })
  } as unknown as DatabaseManager

  const channelManager = {
    createMatchThread: () => Promise.resolve('thread-id'),
    archiveMatchThread: () => Promise.resolve(),
    updateBracketEmbed: () => Promise.resolve()
  } as unknown as TournamentChannelManager

  const notifications = {
    announceLiveUpdate: (...callArguments: unknown[]) => {
      notificationsCalled.push({ name: 'announceLiveUpdate', args: callArguments })
      return Promise.resolve()
    },
    announceWinner: (...callArguments: unknown[]) => {
      notificationsCalled.push({ name: 'announceWinner', args: callArguments })
      return Promise.resolve()
    },
    announceRoundComplete: (...callArguments: unknown[]) => {
      notificationsCalled.push({ name: 'announceRoundComplete', args: callArguments })
      return Promise.resolve()
    },
    notifyMatchStart: () => Promise.resolve(),
    notifyMatchReady: () => Promise.resolve()
  } as unknown as TournamentNotifications

  const manager = new MatchManager(
    databaseManager,
    channelManager,
    notifications,
    async () => tournament,
    () => Promise.resolve(new Map<number, string>()),
    undefined,
    undefined,
    () => undefined,
    () => Promise.resolve(),
    new BracketGenerator()
  )

  return { manager, executed, notificationsCalled }
}

interface AntiAbuseMock {
  checkForfeitPattern: Mock<(playerUuid: string, opponentUuid: string) => Promise<AbuseCheckResult>>
  recordForfeit: Mock<(playerUuid: string, opponentUuid: string) => void>
  checkFalseReporting: Mock<(adminDiscordId: string) => Promise<AbuseCheckResult>>
  recordAdminOverride: Mock<(adminDiscordId: string) => void>
}

function buildAntiAbuseMock(): AntiAbuseMock {
  const checkForfeitPattern = mock.fn<(playerUuid: string, opponentUuid: string) => Promise<AbuseCheckResult>>()
  const recordForfeit = mock.fn<(playerUuid: string, opponentUuid: string) => void>()
  const checkFalseReporting = mock.fn<(adminDiscordId: string) => Promise<AbuseCheckResult>>()
  const recordAdminOverride = mock.fn<(adminDiscordId: string) => void>()

  checkForfeitPattern.mock.mockImplementation((playerUuid: string, opponentUuid: string): Promise<AbuseCheckResult> => {
    void playerUuid
    void opponentUuid
    return Promise.resolve({ allowed: true })
  })
  checkFalseReporting.mock.mockImplementation((adminDiscordId: string): Promise<AbuseCheckResult> => {
    void adminDiscordId
    return Promise.resolve({ allowed: true })
  })

  return { checkForfeitPattern, recordForfeit, checkFalseReporting, recordAdminOverride }
}

function buildMatchManager(
  queryOne: Mock<(sql: string, values: unknown[]) => Promise<unknown>>,
  queryRows: Mock<(sql: string, values: unknown[]) => Promise<unknown[]>>,
  antiAbuse: AntiAbuse,
  onCompleted: () => void
): MatchManager {
  const match = buildMatch()
  const tournament = buildTournament()
  const completedMatch = buildMatch({ status: MatchStatus.Completed, winnerId: 100 })

  queryOne.mock.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes('"tournament_matches"')) {
      return values[0] === match.id ? match : undefined
    }
    if (sql.includes('"tournament_players"')) {
      return values[0] === 100
        ? buildPlayer(100, 'uuid-100', 'discord-100')
        : buildPlayer(200, 'uuid-200', 'discord-200')
    }
    return
  })
  queryRows.mock.mockImplementation(async (sql: string) => {
    if (sql.includes('"tournament_matches"')) return [completedMatch]
    if (sql.includes('"tournament_players"')) return [buildPlayer(100, 'uuid-100', 'discord-100')]
    return []
  })

  const databaseManager = {
    query: mock.fn(),
    queryOne,
    queryRows,
    execute: mock.fn(async () => 1)
  } as unknown as DatabaseManager

  const channelManager = {
    createMatchThread: () => Promise.resolve('thread-id'),
    archiveMatchThread: () => Promise.resolve(),
    updateBracketEmbed: () => Promise.resolve()
  } as unknown as TournamentChannelManager

  const notifications = {
    announceLiveUpdate: () => Promise.resolve(),
    announceWinner: () => Promise.resolve(),
    announceRoundComplete: () => Promise.resolve(),
    notifyMatchStart: () => Promise.resolve()
  } as unknown as TournamentNotifications

  return new MatchManager(
    databaseManager,
    channelManager,
    notifications,
    async () => tournament,
    () => Promise.resolve(new Map<number, string>()),
    undefined,
    antiAbuse,
    () => undefined,
    () => {
      onCompleted()
      return Promise.resolve()
    }
  )
}

describe('MatchManager score & forfeit validation (pure logic)', () => {
  describe('score validation (via validateSeriesScore)', () => {
    it('correctly validates Best-of-3 scores', () => {
      assert.ok(validateSeriesScore(3, 2, 0).valid)
      assert.ok(validateSeriesScore(3, 2, 1).valid)
      assert.ok(validateSeriesScore(3, 0, 2).valid)
      assert.ok(validateSeriesScore(3, 1, 2).valid)
      assert.ok(!validateSeriesScore(3, 2, 2).valid, 'tie should be invalid')
      assert.ok(!validateSeriesScore(3, 1, 1).valid, 'not finished should be invalid')
    })

    it('correctly validates Best-of-5 scores', () => {
      assert.ok(validateSeriesScore(5, 3, 0).valid)
      assert.ok(validateSeriesScore(5, 3, 2).valid)
      assert.ok(validateSeriesScore(5, 0, 3).valid)
      assert.ok(validateSeriesScore(5, 2, 3).valid)
      assert.ok(!validateSeriesScore(5, 3, 3).valid, 'tie should be invalid')
      assert.ok(!validateSeriesScore(5, 2, 2).valid, 'not finished should be invalid')
    })

    it('rejects impossible totals', () => {
      assert.ok(!validateSeriesScore(3, 3, 0).valid, 'cannot exceed bestOf')
      assert.ok(!validateSeriesScore(5, 5, 0).valid, 'cannot exceed bestOf')
    })

    it('rejects negative scores', () => {
      assert.ok(!validateSeriesScore(3, -1, 2).valid)
      assert.ok(!validateSeriesScore(3, 2, -1).valid)
    })
  })

  describe('forfeit logic validation', () => {
    it('p1 forfeits → p2 wins', () => {
      const p1 = 100
      const p2 = 200
      assert.strictEqual(getForfeitWinner(p1, p1, p2), p2)
    })

    it('p2 forfeits → p1 wins', () => {
      const p1 = 100
      const p2 = 200
      assert.strictEqual(getForfeitWinner(p2, p1, p2), p1)
    })

    it('self-forfeit not possible (always gets opponent)', () => {
      const p1 = 100
      const p2 = 200
      assert.notStrictEqual(getForfeitWinner(p1, p1, p2), p1)
    })
  })

  describe('anti-abuse wiring', () => {
    it('forfeit rejects when a suspicious forfeit pattern is flagged', async () => {
      const queryOne = mock.fn<(sql: string, values: unknown[]) => Promise<unknown>>()
      const queryRows = mock.fn<(sql: string, values: unknown[]) => Promise<unknown[]>>()
      const antiAbuse = buildAntiAbuseMock()
      antiAbuse.checkForfeitPattern.mock.mockImplementation((): Promise<AbuseCheckResult> => {
        return Promise.resolve({ allowed: false, reason: 'FLAGGED: Suspicious forfeit pattern' })
      })

      const matchManager = buildMatchManager(queryOne, queryRows, antiAbuse as unknown as AntiAbuse, () => {
        /* noop */
      })
      await assert.rejects(async () => await matchManager.forfeit(1, 100), /Suspicious forfeit pattern/)
      assert.equal(antiAbuse.recordForfeit.mock.callCount(), 0)
    })

    it('forfeit records the forfeit after a successful resolution', async () => {
      const queryOne = mock.fn<(sql: string, values: unknown[]) => Promise<unknown>>()
      const queryRows = mock.fn<(sql: string, values: unknown[]) => Promise<unknown[]>>()
      const antiAbuse = buildAntiAbuseMock()

      let completed = false
      const matchManager = buildMatchManager(queryOne, queryRows, antiAbuse as unknown as AntiAbuse, () => {
        completed = true
      })
      await matchManager.forfeit(1, 100)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(antiAbuse.recordForfeit.mock.callCount(), 1)
      assert.equal(completed, true)
    })

    it('adminConfirm rejects when false reporting is flagged', async () => {
      const queryOne = mock.fn<(sql: string, values: unknown[]) => Promise<unknown>>()
      const queryRows = mock.fn<(sql: string, values: unknown[]) => Promise<unknown[]>>()
      const antiAbuse = buildAntiAbuseMock()
      antiAbuse.checkFalseReporting.mock.mockImplementation((): Promise<AbuseCheckResult> => {
        return Promise.resolve({ allowed: false, reason: 'FLAGGED: High admin override rate' })
      })

      const matchManager = buildMatchManager(queryOne, queryRows, antiAbuse as unknown as AntiAbuse, () => {
        /* noop */
      })
      await assert.rejects(async () => {
        await matchManager.adminConfirm(1, 100, 'discord-admin')
      }, /High admin override rate/)
      assert.equal(antiAbuse.recordAdminOverride.mock.callCount(), 0)
    })

    it('adminConfirm records the override after a successful resolution', async () => {
      const queryOne = mock.fn<(sql: string, values: unknown[]) => Promise<unknown>>()
      const queryRows = mock.fn<(sql: string, values: unknown[]) => Promise<unknown[]>>()
      const antiAbuse = buildAntiAbuseMock()

      const matchManager = buildMatchManager(queryOne, queryRows, antiAbuse as unknown as AntiAbuse, () => {
        /* noop */
      })
      await matchManager.adminConfirm(1, 100, 'discord-admin')
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(antiAbuse.recordAdminOverride.mock.callCount(), 1)
    })
  })

  describe('round-robin resolution', () => {
    it('does not eliminate losers, does not advance, and crowns the standings champion', async () => {
      const tournament = buildTournament({ bracketFormat: 'round-robin' })
      const players = [
        buildPlayer(100, 'uuid-100', 'discord-100'),
        buildPlayer(200, 'uuid-200', 'discord-200'),
        buildPlayer(300, 'uuid-300', 'discord-300')
      ]
      const matches = [
        buildMatch({ id: 1, player1Id: 100, player2Id: 200 }),
        buildMatch({ id: 2, player1Id: 100, player2Id: 300 }),
        buildMatch({ id: 3, player1Id: 200, player2Id: 300 })
      ]
      const { manager, executed } = buildHarness(tournament, matches, players)

      await manager.adminConfirm(1, 100)
      assert.ok(
        !executed.some((entry) => entry.sql.includes('UPDATE "tournament_players"')),
        'round-robin losers must not be eliminated'
      )
      assert.ok(
        !executed.some(
          (entry) =>
            entry.sql.includes('UPDATE "tournament_matches" SET "player1Id"') ||
            entry.sql.includes('UPDATE "tournament_matches" SET "player2Id"')
        ),
        'round-robin matches must not advance anywhere'
      )

      await manager.adminConfirm(2, 100)
      await manager.adminConfirm(3, 200)

      const completion = executed.find((entry) =>
        entry.sql.includes('UPDATE "tournaments" SET "status" = $1, "winnerId" = $2')
      )
      assert.ok(completion !== undefined, 'tournament should be completed once all matches resolve')
      assert.strictEqual(completion.values[1], 100, 'standings champion (2-0) should be crowned')
      assert.ok(
        !executed.some((entry) => entry.sql.includes('UPDATE "tournaments" SET "currentRound"')),
        'round-robin must not progress currentRound'
      )
    })
  })

  describe('double-elimination resolution', () => {
    it('advances the loser into loserNextMatchId without eliminating', async () => {
      const tournament = buildTournament({
        bracketFormat: 'double-elim',
        discordChannelId: 'channel-1',
        bracketMessageId: 'message-1'
      })
      const players = [
        buildPlayer(100, 'uuid-100', 'discord-100'),
        buildPlayer(200, 'uuid-200', 'discord-200'),
        buildPlayer(300, 'uuid-300', 'discord-300')
      ]
      const matches = [
        buildMatch({
          id: 1,
          round: 1,
          matchIndex: 1,
          player1Id: 100,
          player2Id: 200,
          winnerId: undefined,
          nextMatchId: 5,
          loserNextMatchId: 4,
          status: MatchStatus.Active,
          discordThreadId: undefined
        }),
        buildMatch({
          id: 4,
          round: 4,
          matchIndex: 1,
          player1Id: 300,
          player2Id: undefined,
          winnerId: undefined,
          nextMatchId: 6,
          status: MatchStatus.Pending,
          discordThreadId: undefined
        }),
        buildMatch({
          id: 5,
          round: 2,
          matchIndex: 0,
          status: MatchStatus.Pending,
          discordThreadId: undefined
        }),
        buildMatch({
          id: 6,
          round: 5,
          matchIndex: 0,
          status: MatchStatus.Pending,
          discordThreadId: undefined
        })
      ]
      const { manager, executed } = buildHarness(tournament, matches, players)

      await manager.adminConfirm(1, 100)

      const loserPlacement = executed.find(
        (entry) =>
          entry.sql.includes('UPDATE "tournament_matches" SET "player2Id"') &&
          entry.values[0] === 200 &&
          entry.values[1] === 4
      )
      assert.ok(loserPlacement !== undefined, 'loser should be placed into player2Id of loserNextMatchId (odd source)')
      assert.ok(
        !executed.some((entry) => entry.sql.includes('UPDATE "tournament_players"')),
        'loser with a loserNextMatchId must not be eliminated'
      )
      const activation = executed.find(
        (entry) =>
          entry.sql.includes('UPDATE "tournament_matches" SET "status" = $1, "deadlineAt" = $2') &&
          entry.values[2] === 4
      )
      assert.ok(activation !== undefined, 'lower bracket match should activate once both slots fill')
      assert.ok(
        !executed.some((entry) => entry.sql.includes('UPDATE "tournaments" SET "currentRound"')),
        'double-elim must not progress currentRound'
      )
    })
  })

  describe('BYE match resolution', () => {
    it('advances BYE winners into the next match and activates it when full', async () => {
      const tournament = buildTournament({ discordChannelId: 'channel-1', bracketMessageId: 'message-1' })
      const players = [buildPlayer(100, 'uuid-100', 'discord-100'), buildPlayer(200, 'uuid-200', 'discord-200')]
      const matches = [
        buildMatch({
          id: 1,
          round: 1,
          matchIndex: 0,
          player1Id: 100,
          player2Id: undefined,
          winnerId: 100,
          nextMatchId: 5,
          status: MatchStatus.Bye,
          completedAt: 0
        }),
        buildMatch({
          id: 2,
          round: 1,
          matchIndex: 1,
          player1Id: 200,
          player2Id: undefined,
          winnerId: 200,
          nextMatchId: 5,
          status: MatchStatus.Bye,
          completedAt: 0
        }),
        buildMatch({
          id: 5,
          round: 2,
          matchIndex: 0,
          status: MatchStatus.Pending,
          discordThreadId: undefined
        })
      ]
      const { manager, executed } = buildHarness(tournament, matches, players)

      await manager.resolveByeMatch(1, 100)
      await manager.resolveByeMatch(2, 200)

      const completed = executed.filter((entry) =>
        entry.sql.includes('UPDATE "tournament_matches" SET "status" = $1, "winnerId" = $2, "completedAt" = $3')
      )
      assert.strictEqual(completed.length, 2, 'both BYE matches should be marked completed')
      assert.ok(
        completed.every((entry) => entry.values[0] === MatchStatus.Completed),
        'BYE matches should resolve to completed status'
      )
      assert.ok(
        executed.some(
          (entry) => entry.sql.includes('UPDATE "tournament_matches" SET "player1Id"') && entry.values[0] === 100
        ),
        'first BYE winner should fill the player1 slot of round 2 (even source matchIndex)'
      )
      assert.ok(
        executed.some(
          (entry) => entry.sql.includes('UPDATE "tournament_matches" SET "player2Id"') && entry.values[0] === 200
        ),
        'second BYE winner should fill the player2 slot of round 2 (odd source matchIndex)'
      )
      const activation = executed.find(
        (entry) =>
          entry.sql.includes('UPDATE "tournament_matches" SET "status" = $1, "deadlineAt" = $2') &&
          entry.values[2] === 5
      )
      assert.ok(activation !== undefined, 'round 2 match should activate once both slots fill')
      assert.ok(
        !executed.some((entry) => entry.sql.includes('UPDATE "tournament_players"')),
        'BYE matches have no loser to eliminate'
      )
    })

    it('rejects non-BYE matches', async () => {
      const tournament = buildTournament()
      const players = [buildPlayer(100, 'uuid-100', 'discord-100'), buildPlayer(200, 'uuid-200', 'discord-200')]
      const matches = [buildMatch({ id: 1, status: MatchStatus.Active })]
      const { manager } = buildHarness(tournament, matches, players)

      await assert.rejects(async () => {
        await manager.resolveByeMatch(1, 100)
      }, /not a BYE match/)
    })
  })
})
