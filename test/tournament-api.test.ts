import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import type http from 'node:http'
import { describe, it } from 'node:test'

import type { Logger } from 'log4js'

import type Application from '../src/application.js'
import { Permission } from '../src/common/application-event.js'
import { MatchStatus, TournamentStatus } from '../src/core/tournament/types.js'
import type { Tournament, TournamentMatch } from '../src/core/tournament/types.js'
import { signToken } from '../src/instance/web/signed-token.js'
import { TournamentApiHandler } from '../src/instance/web/tournament-api.js'

const SIGNING_SECRET = 'test-signing-secret'

interface TournamentResult {
  id: number
  playerUuid: string
  discordId: string | undefined
  tournamentId: number
  placement: number
  roundsReached: number
  wins: number
  losses: number
  champion: number
  createdAt: number
}

// eslint-disable-next-line unicorn/prefer-event-target -- http.IncomingMessage is an EventEmitter; the handler relies on the .on() API that EventTarget lacks
class FakeRequest extends EventEmitter {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>

  constructor(method: string, url: string) {
    super()
    this.method = method
    this.url = url
    this.headers = {}
  }

  setEncoding(): void {}

  feedBody(body: string): void {
    if (body.length > 0) this.emit('data', body)
    this.emit('end')
  }
}

class FakeResponse {
  statusCode = 0
  statusMessage = ''
  headers: Record<string, string | string[]> = {}
  body = ''
  ended = false

  writeHead(status: number, headers?: Record<string, string | string[]>): void {
    this.statusCode = status
    if (headers) this.headers = { ...this.headers, ...headers }
  }

  setHeader(name: string, value: string | string[]): void {
    this.headers[name] = value
  }

  end(data?: string): void {
    this.ended = true
    if (data !== undefined) this.body = data
  }
}

function makeToken(permission: Permission, userId: string): string {
  return signToken(
    {
      sub: userId,
      perm: permission,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    },
    SIGNING_SECRET
  )
}

interface FakeHarness {
  handler: TournamentApiHandler
  db: {
    queryRows: (sql: string, parameters: unknown[]) => Promise<unknown[]>
    queryOne: (sql: string, parameters: unknown[]) => Promise<unknown>
    execute: (sql: string, parameters: unknown[]) => Promise<void>
  }
  rewindCalls: { matchId: number; actorDiscordId?: string }[]
  createCalls: unknown[][]
  activeByBridge: Record<string, Tournament | undefined>
  defaults: { bestOf: number; deadlineHours: number; checkinMinutes: number; bracketFormat: string }
}

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1,
    bridgeId: 'bridge-a',
    name: 'Test Cup',
    gameType: 'Bridge',
    bestOf: 1,
    status: TournamentStatus.Signup,
    roundDeadlineHours: 48,
    createdBy: 'web-ui',
    winnerId: undefined,
    discordChannelId: undefined,
    bracketMessageId: undefined,
    categoryChannelId: undefined,
    liveChannelId: undefined,
    checkinOpensAt: undefined,
    checkinClosesAt: undefined,
    startedAtUnix: undefined,
    currentRound: 0,
    totalRounds: 0,
    bracketFormat: 'single-elim',
    createdAt: 123,
    startedAt: undefined,
    completedAt: undefined,
    ...overrides
  }
}

function setupTest(): FakeHarness {
  const rewindCalls: { matchId: number; actorDiscordId?: string }[] = []
  const createCalls: unknown[][] = []
  const activeByBridge: Record<string, Tournament | undefined> = {}
  const defaults = { bestOf: 1, deadlineHours: 48, checkinMinutes: 60, bracketFormat: 'single-elim' }
  const database: FakeHarness['db'] = {
    queryRows: () => Promise.resolve([]),
    queryOne: () => Promise.resolve(undefined),
    execute: () => Promise.resolve()
  }
  const databaseManager = {
    queryRows: (sql: string, parameters: unknown[]) => database.queryRows(sql, parameters),
    queryOne: (sql: string, parameters: unknown[]) => database.queryOne(sql, parameters),
    execute: (sql: string, parameters: unknown[]) => database.execute(sql, parameters)
  }
  const app = {
    config: { web: { signingSecret: SIGNING_SECRET } },
    core: {
      databaseManager,
      bridgeConfigurations: {
        getTournamentDefaultBestOf: (): number => defaults.bestOf,
        getTournamentDefaultDeadlineHours: (): number => defaults.deadlineHours,
        getTournamentCheckinWindowMinutes: (): number => defaults.checkinMinutes,
        getTournamentDefaultBracketFormat: (): string => defaults.bracketFormat,
        setTournamentCategoryId: (): void => {}
      },
      tournamentManager: {
        auditLogger: {
          log: () => Promise.resolve()
        },
        rewindMatch: (matchId: number, actorDiscordId?: string): void => {
          rewindCalls.push({ matchId, actorDiscordId })
        },
        createTournament: (...callArguments: unknown[]): Tournament => {
          createCalls.push(callArguments)
          const bridgeId = String(callArguments[0])
          const existing = activeByBridge[bridgeId]
          if (
            existing !== undefined &&
            (existing.status === TournamentStatus.Signup || existing.status === TournamentStatus.Active)
          ) {
            throw new Error(`An active tournament already exists for this bridge: "${existing.name}"`)
          }
          return makeTournament({
            bridgeId,
            name: String(callArguments[1]),
            gameType: String(callArguments[2]),
            bestOf: Number(callArguments[3]),
            roundDeadlineHours: Number(callArguments[5]),
            bracketFormat: (callArguments[8] as string | undefined) ?? 'single-elim'
          })
        },
        getActiveTournament: (bridgeId: string): Tournament | undefined => activeByBridge[bridgeId]
      }
    }
  } as unknown as Application
  const logger: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    level: 'off',
    isLevelEnabled: () => false,
    log: () => {},
    setLevel: () => {},
    getLevel: () => 'off'
  } as unknown as Logger
  const handler = new TournamentApiHandler(app, logger)
  return { handler, db: database, rewindCalls, createCalls, activeByBridge, defaults }
}

async function runHandler(
  method: string,
  url: string,
  harness: FakeHarness,
  token: string,
  body?: string
): Promise<{ request: FakeRequest; response: FakeResponse; handled: boolean }> {
  const request = new FakeRequest(method, url)
  request.headers = { authorization: `Bearer ${token}` }
  const response = new FakeResponse()
  const promise = harness.handler.handle(
    request as unknown as http.IncomingMessage,
    response as unknown as http.ServerResponse
  )
  if (body === undefined) {
    request.feedBody('')
  } else {
    request.feedBody(body)
  }
  const handled = await promise
  return { request, response, handled }
}

await describe('TournamentApiHandler', async () => {
  await it('POST /api/tournament/:id/undo calls rewindMatch with matchId and actor id', async () => {
    const harness = setupTest()
    const match: TournamentMatch = {
      id: 7,
      tournamentId: 5,
      round: 1,
      matchIndex: 0,
      player1Id: 1,
      player2Id: 2,
      winnerId: 1,
      nextMatchId: undefined,
      status: MatchStatus.Completed,
      player1Wins: 2,
      player2Wins: 0,
      discordThreadId: undefined,
      deadlineAt: undefined,
      warningsSent: 0,
      completedAt: 123,
      deadlineExtensionMinutes: 0,
      manuallyExtended: false,
      hadProofAttachment: false
    }
    harness.db.queryOne = () => Promise.resolve(match)
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament/5/undo',
      harness,
      makeToken(Permission.Officer, 'officer-1'),
      JSON.stringify({ matchId: 7 })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as { success: boolean; data: { success: boolean } }
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.success, true)
    assert.deepStrictEqual(harness.rewindCalls, [{ matchId: 7, actorDiscordId: 'officer-1' }])
  })

  await it('POST /api/tournament/:id/undo requires Officer permission', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament/5/undo',
      harness,
      makeToken(Permission.Helper, 'helper-1'),
      JSON.stringify({ matchId: 7 })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 403)
    assert.strictEqual(harness.rewindCalls.length, 0)
  })

  await it('POST /api/tournament/:id/undo returns 404 for a match outside the tournament', async () => {
    const harness = setupTest()
    harness.db.queryOne = () => Promise.resolve(undefined)
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament/5/undo',
      harness,
      makeToken(Permission.Officer, 'officer-1'),
      JSON.stringify({ matchId: 99 })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 404)
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } }
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error.code, 'NOT_FOUND')
    assert.strictEqual(harness.rewindCalls.length, 0)
  })

  await it('POST /api/tournament/:id/undo returns 400 when matchId is missing', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament/5/undo',
      harness,
      makeToken(Permission.Officer, 'officer-1'),
      JSON.stringify({})
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 400)
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } }
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR')
    assert.strictEqual(harness.rewindCalls.length, 0)
  })

  await it('GET /api/tournament/:id/results returns results ordered by placement', async () => {
    const harness = setupTest()
    const results: TournamentResult[] = [
      {
        id: 1,
        playerUuid: 'uuid-a',
        discordId: 'd1',
        tournamentId: 5,
        placement: 2,
        roundsReached: 3,
        wins: 2,
        losses: 1,
        champion: 0,
        createdAt: 100
      },
      {
        id: 2,
        playerUuid: 'uuid-b',
        discordId: 'd2',
        tournamentId: 5,
        placement: 1,
        roundsReached: 3,
        wins: 3,
        losses: 0,
        champion: 1,
        createdAt: 100
      }
    ]
    let querySql = ''
    let queryParameters: unknown[] = []
    harness.db.queryRows = (sql: string, parameters: unknown[]): Promise<unknown[]> => {
      querySql = sql
      queryParameters = parameters
      return Promise.resolve(results)
    }
    const { response, handled } = await runHandler(
      'GET',
      '/api/tournament/5/results',
      harness,
      makeToken(Permission.Helper, 'helper-1')
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    assert.match(querySql, /"tournament_results"/)
    assert.match(querySql, /ORDER BY "placement" ASC/)
    assert.deepStrictEqual(queryParameters, [5])
    const body = JSON.parse(response.body) as { success: boolean; data: TournamentResult[] }
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.length, 2)
    assert.strictEqual(body.data[0]?.placement, 2)
    assert.strictEqual(body.data[1]?.champion, 1)
  })

  await it('GET /api/tournament/:id/results returns an empty array when no results exist', async () => {
    const harness = setupTest()
    harness.db.queryRows = () => Promise.resolve([])
    const { response, handled } = await runHandler(
      'GET',
      '/api/tournament/5/results',
      harness,
      makeToken(Permission.Helper, 'helper-1')
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as { success: boolean; data: unknown[] }
    assert.strictEqual(body.success, true)
    assert.deepStrictEqual(body.data, [])
  })

  await it('POST /api/tournament applies bridge settings defaults when fields are omitted', async () => {
    const harness = setupTest()
    harness.defaults.bestOf = 3
    harness.defaults.deadlineHours = 24
    harness.defaults.checkinMinutes = 30
    harness.defaults.bracketFormat = 'double-elim'
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament',
      harness,
      makeToken(Permission.Admin, 'admin-1'),
      JSON.stringify({ bridgeId: 'bridge-a', name: 'Cup #1', gameType: 'Bridge' })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as { success: boolean; data: Tournament }
    assert.strictEqual(body.success, true)
    assert.deepStrictEqual(harness.createCalls[0], [
      'bridge-a',
      'Cup #1',
      'Bridge',
      3,
      'admin-1',
      24,
      undefined,
      30,
      'double-elim'
    ])
    assert.strictEqual(body.data.bestOf, 3)
    assert.strictEqual(body.data.roundDeadlineHours, 24)
    assert.strictEqual(body.data.bracketFormat, 'double-elim')
  })

  await it('POST /api/tournament honors explicitly provided fields over bridge defaults', async () => {
    const harness = setupTest()
    harness.defaults.bestOf = 5
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament',
      harness,
      makeToken(Permission.Admin, 'admin-1'),
      JSON.stringify({
        bridgeId: 'bridge-a',
        name: 'Cup #2',
        gameType: 'BedWars',
        bestOf: 3,
        roundDeadlineHours: 12,
        checkinWindowMinutes: 15,
        bracketFormat: 'round-robin',
        startedAtUnix: Math.floor(Date.now() / 1000) + 3600
      })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(harness.createCalls[0]?.slice(0, 4), ['bridge-a', 'Cup #2', 'BedWars', 3])
    assert.strictEqual(harness.createCalls[0]?.[5], 12)
    assert.strictEqual(harness.createCalls[0]?.[7], 15)
    assert.strictEqual(harness.createCalls[0]?.[8], 'round-robin')
  })

  await it('POST /api/tournament rejects even bestOf', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament',
      harness,
      makeToken(Permission.Admin, 'admin-1'),
      JSON.stringify({ bridgeId: 'bridge-a', name: 'Cup #3', gameType: 'Bridge', bestOf: 4 })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 400)
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } }
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR')
    assert.strictEqual(harness.createCalls.length, 0)
  })

  await it('POST /api/tournament rejects a scheduled start in the past', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament',
      harness,
      makeToken(Permission.Admin, 'admin-1'),
      JSON.stringify({
        bridgeId: 'bridge-a',
        name: 'Cup #4',
        gameType: 'Bridge',
        startedAtUnix: Math.floor(Date.now() / 1000) - 3600
      })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 400)
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } }
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR')
    assert.match(body.error.message, /future/)
    assert.strictEqual(harness.createCalls.length, 0)
  })

  await it('POST /api/tournament rejects an unknown bracket format', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament',
      harness,
      makeToken(Permission.Admin, 'admin-1'),
      JSON.stringify({ bridgeId: 'bridge-a', name: 'Cup #5', gameType: 'Bridge', bracketFormat: 'ladder' })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 400)
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } }
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR')
    assert.strictEqual(harness.createCalls.length, 0)
  })

  await it('POST /api/tournament returns 409 when the bridge already has an active tournament', async () => {
    const harness = setupTest()
    harness.activeByBridge['bridge-a'] = makeTournament({
      id: 7,
      bridgeId: 'bridge-a',
      name: 'Existing Cup',
      status: TournamentStatus.Active
    })
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament',
      harness,
      makeToken(Permission.Admin, 'admin-1'),
      JSON.stringify({ bridgeId: 'bridge-a', name: 'Cup #6', gameType: 'Bridge' })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 409)
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } }
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error.code, 'CONFLICT')
    assert.strictEqual(harness.createCalls.length, 1)
  })

  await it('GET /api/tournament/active returns the active tournament for a bridge', async () => {
    const harness = setupTest()
    harness.activeByBridge['bridge-a'] = makeTournament({ id: 9, name: 'Live Cup', status: TournamentStatus.Active })
    const { response, handled } = await runHandler(
      'GET',
      '/api/tournament/active?bridgeId=bridge-a',
      harness,
      makeToken(Permission.Helper, 'helper-1')
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as { success: boolean; data: { tournament: Tournament } }
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.tournament.id, 9)
    assert.strictEqual(body.data.tournament.name, 'Live Cup')
  })

  await it('GET /api/tournament/active returns null when the bridge has no active tournament', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'GET',
      '/api/tournament/active?bridgeId=bridge-a',
      harness,
      makeToken(Permission.Helper, 'helper-1')
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as { success: boolean; data: { tournament: Tournament | undefined } }
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.tournament, undefined)
  })

  await it('GET /api/tournament/active requires the bridgeId query parameter', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'GET',
      '/api/tournament/active',
      harness,
      makeToken(Permission.Helper, 'helper-1')
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 400)
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } }
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR')
  })

  await it('POST /api/tournament/test/create seeds fake players and creates a tournament', async () => {
    const harness = setupTest()
    const executeCalls: { sql: string; parameters: unknown[] }[] = []
    harness.db.execute = (sql: string, parameters: unknown[]): Promise<void> => {
      executeCalls.push({ sql, parameters })
      return Promise.resolve()
    }
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament/test/create',
      harness,
      makeToken(Permission.Admin, 'admin-1'),
      JSON.stringify({ bridgeId: 'bridge-a', playerCount: 4, autoStart: false })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as { success: boolean; data: Tournament }
    assert.strictEqual(body.success, true)
    assert.deepStrictEqual(harness.createCalls[0]?.slice(0, 6), [
      'bridge-a',
      'Test Tournament',
      'Bridge',
      1,
      'admin-1',
      48
    ])
    assert.strictEqual(executeCalls.length, 4)
    const first = executeCalls[0]
    assert.ok(first)
    assert.match(first.sql, /INSERT INTO "tournament_players"/)
    assert.strictEqual(first.parameters[1], '00000000-0000-0000-0000-000000000001')
    assert.strictEqual(first.parameters[3], 1)
  })

  await it('POST /api/tournament/test/create requires Admin permission', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament/test/create',
      harness,
      makeToken(Permission.Officer, 'officer-1'),
      JSON.stringify({ bridgeId: 'bridge-a' })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 403)
    assert.strictEqual(harness.createCalls.length, 0)
  })

  await it('POST /api/tournament/test/create rejects playerCount outside 2-32', async () => {
    const harness = setupTest()
    const { response, handled } = await runHandler(
      'POST',
      '/api/tournament/test/create',
      harness,
      makeToken(Permission.Admin, 'admin-1'),
      JSON.stringify({ bridgeId: 'bridge-a', playerCount: 64, autoStart: false })
    )
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 400)
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } }
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR')
    assert.strictEqual(harness.createCalls.length, 0)
  })
})
