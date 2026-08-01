import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import type http from 'node:http'
import { describe, it } from 'node:test'

import type { Logger } from 'log4js'

import type Application from '../src/application.js'
import { Permission } from '../src/common/application-event.js'
import { MatchStatus, type TournamentMatch } from '../src/core/tournament/types.js'
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

  setEncoding(_encoding: string): void {}

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
  }
  rewindCalls: { matchId: number; actorDiscordId?: string }[]
  request: FakeRequest
  response: FakeResponse
}

function setupTest(): Omit<FakeHarness, 'request' | 'response'> {
  const rewindCalls: { matchId: number; actorDiscordId?: string }[] = []
  const database: FakeHarness['db'] = {
    queryRows: async (_sql: string, _parameters: unknown[]) => [],
    queryOne: async (_sql: string, _parameters: unknown[]) => undefined
  }
  const databaseManager = {
    queryRows: (sql: string, parameters: unknown[]) => database.queryRows(sql, parameters),
    queryOne: (sql: string, parameters: unknown[]) => database.queryOne(sql, parameters)
  }
  const app = {
    config: { web: { signingSecret: SIGNING_SECRET } },
    core: {
      databaseManager,
      tournamentManager: {
        rewindMatch: async (matchId: number, actorDiscordId?: string): Promise<void> => {
          rewindCalls.push({ matchId, actorDiscordId })
        }
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
  return { handler, db: database, rewindCalls }
}

async function runHandler(
  method: string,
  url: string,
  harness: Omit<FakeHarness, 'request' | 'response'>,
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
    harness.db.queryOne = async () => match
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
    harness.db.queryOne = async () => undefined
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
    harness.db.queryRows = async (sql: string, parameters: unknown[]) => {
      querySql = sql
      queryParameters = parameters
      return results
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
    harness.db.queryRows = async () => []
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
})
