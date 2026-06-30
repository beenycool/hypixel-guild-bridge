import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import type http from 'node:http'
import { describe, it } from 'node:test'

import type { Logger } from 'log4js'

import type Application from '../src/application.js'
import type { PendingReview, RankupHistoryEntry } from '../src/core/rankup/pending-review-manager.js'
import { RankupApiHandler } from '../src/instance/web/rankup-api.js'

class FakeRequest extends EventEmitter {
  method: string
  url: string

  constructor(method: string, url: string) {
    super()
    this.method = method
    this.url = url
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

interface FakeBridgeConfigurations {
  getAllBridgeIds: () => string[]
  getRankupEnabled: (bridgeId: string) => boolean
  getRankupManualReview: (bridgeId: string) => boolean
  getRankupNotificationCooldown: (bridgeId: string) => number
  getRankupNotificationChannelIds: (bridgeId: string) => string[]
  getRankupRules: (bridgeId: string) => unknown[]
  getRankupDemotionRules: (bridgeId: string) => unknown[]
  getRankupExcludedRanks: (bridgeId: string) => string[]
  getRankupExcludedPlayers: (bridgeId: string) => string[]
  getMinecraftInstances: (bridgeId: string) => string[]
  setRankupEnabled: (bridgeId: string, value: boolean) => void
  setRankupManualReview: (bridgeId: string, value: boolean) => void
  setRankupNotificationCooldown: (bridgeId: string, value: number) => void
  setRankupNotificationChannelIds: (bridgeId: string, value: string[]) => void
  setRankupRules: (bridgeId: string, value: unknown[]) => void
  setRankupDemotionRules: (bridgeId: string, value: unknown[]) => void
  setRankupExcludedRanks: (bridgeId: string, value: string[]) => void
  setRankupExcludedPlayers: (bridgeId: string, value: string[]) => void
}

interface FakePendingReviewManager {
  getReviews: (bridgeId: string) => PendingReview[]
  getReview: (id: number) => PendingReview | undefined
  removeReview: (id: number) => void
  logHistory: (...arguments_: unknown[]) => void
  getHistory: (bridgeId: string, limit: number) => RankupHistoryEntry[]
  getHistoryCalls: { bridgeId: string; limit: number }[]
}

interface FakeRankupManager {
  runTaskForBridge: (bridgeId: string) => Promise<void>
  runTaskCalls: string[]
  approveReview: (bridgeId: string, id: number) => Promise<void>
  approveCalls: { bridgeId: string; id: number }[]
}

function createFakeBridgeConfigurations(overrides: Partial<FakeBridgeConfigurations> = {}): FakeBridgeConfigurations {
  return {
    getAllBridgeIds: () => ['a'],
    getRankupEnabled: () => true,
    getRankupManualReview: () => false,
    getRankupNotificationCooldown: () => 24,
    getRankupNotificationChannelIds: () => [],
    getRankupRules: () => [],
    getRankupDemotionRules: () => [],
    getRankupExcludedRanks: () => [],
    getRankupExcludedPlayers: () => [],
    getMinecraftInstances: () => ['bot-a'],
    setRankupEnabled: () => {},
    setRankupManualReview: () => {},
    setRankupNotificationCooldown: () => {},
    setRankupNotificationChannelIds: () => {},
    setRankupRules: () => {},
    setRankupDemotionRules: () => {},
    setRankupExcludedRanks: () => {},
    setRankupExcludedPlayers: () => {},
    ...overrides
  }
}

function createFakePendingReviewManager(overrides: Partial<FakePendingReviewManager> = {}): FakePendingReviewManager {
  return {
    getReviews: () => [],
    getReview: () => undefined,
    removeReview: () => {},
    logHistory: () => {},
    getHistory: () => [],
    getHistoryCalls: [],
    ...overrides
  }
}

function createFakeRankupManager(): FakeRankupManager {
  return {
    runTaskForBridge: async () => {},
    runTaskCalls: [],
    approveReview: async () => {},
    approveCalls: []
  }
}

interface FakeHarness {
  app: Application
  handler: RankupApiHandler
  bridgeConfigurations: FakeBridgeConfigurations
  pendingReviewManager: FakePendingReviewManager
  rankupManager: FakeRankupManager
  request: FakeRequest
  response: FakeResponse
}

async function setupTest(
  overrides: {
    bridgeConfigurations?: Partial<FakeBridgeConfigurations>
    pendingReviewManager?: Partial<FakePendingReviewManager>
    rankupManager?: boolean
  } = {}
): Promise<Omit<FakeHarness, 'request' | 'response'>> {
  const bridgeConfigurations = createFakeBridgeConfigurations(overrides.bridgeConfigurations)
  const pendingReviewManager = createFakePendingReviewManager(overrides.pendingReviewManager)
  const rankupManager = createFakeRankupManager()
  const eventEmitter = new EventEmitter()
  const app = {
    on: (event: string, callback: (...arguments_: unknown[]) => void) => eventEmitter.on(event, callback),
    core: {
      bridgeConfigurations,
      pendingReviewManager,
      rankupManager
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
  const handler = new RankupApiHandler(app, logger)
  return { app, handler, bridgeConfigurations, pendingReviewManager, rankupManager }
}

async function runHandler(
  method: string,
  url: string,
  harness: Omit<FakeHarness, 'request' | 'response'>,
  body?: string
): Promise<{ request: FakeRequest; response: FakeResponse; handled: boolean }> {
  const request = new FakeRequest(method, url)
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

await describe('RankupApiHandler', async () => {
  await it('GET /api/rankup/bridges returns bridge list with pendingCount and lastCheckAt', async () => {
    const review1: PendingReview = {
      id: 1,
      bridgeId: 'a',
      uuid: 'u1',
      currentRank: 'Member',
      proposedRank: 'Officer',
      action: 'promote',
      reason: 'r',
      createdAt: 1,
      notifiedAt: undefined
    }
    const review2: PendingReview = { ...review1, id: 2, uuid: 'u2' }
    const harness = await setupTest({
      pendingReviewManager: { getReviews: () => [review1, review2] }
    })
    const { response, handled } = await runHandler('GET', '/api/rankup/bridges', harness)
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as {
      bridges: {
        bridgeId: string
        enabled: boolean
        manualReview: boolean
        pendingCount: number
        lastCheckAt: number | null
      }[]
    }
    assert.deepStrictEqual(body, {
      bridges: [{ bridgeId: 'a', enabled: true, manualReview: false, pendingCount: 2, lastCheckAt: null }]
    })
  })

  await it('GET /api/rankup/pending returns reviews for a bridge', async () => {
    const review: PendingReview = {
      id: 1,
      bridgeId: 'a',
      uuid: 'u1',
      currentRank: 'Member',
      proposedRank: 'Officer',
      action: 'promote',
      reason: 'r',
      createdAt: 1,
      notifiedAt: undefined
    }
    const harness = await setupTest({
      pendingReviewManager: { getReviews: () => [review] }
    })
    const { response, handled } = await runHandler('GET', '/api/rankup/pending?bridgeId=a', harness)
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as { reviews: PendingReview[] }
    assert.strictEqual(body.reviews.length, 1)
    assert.strictEqual(body.reviews[0]?.id, 1)
  })

  await it('GET /api/rankup/pending without bridgeId returns 400', async () => {
    const harness = await setupTest()
    const { response, handled } = await runHandler('GET', '/api/rankup/pending', harness)
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 400)
    const body = JSON.parse(response.body) as { success: boolean; error: string }
    assert.strictEqual(body.success, false)
    assert.match(body.error, /bridgeId/)
  })

  await it('GET /api/rankup/rules returns full config', async () => {
    const promotionRules = [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }]
    const demotionRules = [
      { fromRank: 'Officer', action: 'demote' as const, targetRank: 'Member', maxWeeklyGexp: 1000, gracePeriod: 7 }
    ]
    const harness = await setupTest({
      bridgeConfigurations: {
        getRankupEnabled: () => true,
        getRankupManualReview: () => true,
        getRankupNotificationCooldown: () => 48,
        getRankupNotificationChannelIds: () => ['chan-1'],
        getRankupRules: () => promotionRules,
        getRankupDemotionRules: () => demotionRules,
        getRankupExcludedRanks: () => ['Staff'],
        getRankupExcludedPlayers: () => ['uuid-x']
      }
    })
    const { response, handled } = await runHandler('GET', '/api/rankup/rules?bridgeId=a', harness)
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body) as {
      enabled: boolean
      manualReview: boolean
      notificationCooldown: number
      notificationChannelIds: string[]
      promotionRules: unknown[]
      demotionRules: unknown[]
      excludedRanks: string[]
      excludedPlayers: string[]
    }
    assert.strictEqual(body.enabled, true)
    assert.strictEqual(body.manualReview, true)
    assert.strictEqual(body.notificationCooldown, 48)
    assert.deepStrictEqual(body.notificationChannelIds, ['chan-1'])
    assert.deepStrictEqual(body.promotionRules, promotionRules)
    assert.deepStrictEqual(body.demotionRules, demotionRules)
    assert.deepStrictEqual(body.excludedRanks, ['Staff'])
    assert.deepStrictEqual(body.excludedPlayers, ['uuid-x'])
  })

  await it('PUT /api/rankup/rules calls all 8 setters', async () => {
    const setterCalls: { name: string; args: unknown[] }[] = []
    const harness = await setupTest({
      bridgeConfigurations: {
        setRankupEnabled: (bridgeId, value) => setterCalls.push({ name: 'setRankupEnabled', args: [bridgeId, value] }),
        setRankupManualReview: (bridgeId, value) =>
          setterCalls.push({ name: 'setRankupManualReview', args: [bridgeId, value] }),
        setRankupNotificationCooldown: (bridgeId, value) =>
          setterCalls.push({ name: 'setRankupNotificationCooldown', args: [bridgeId, value] }),
        setRankupNotificationChannelIds: (bridgeId, value) =>
          setterCalls.push({ name: 'setRankupNotificationChannelIds', args: [bridgeId, value] }),
        setRankupRules: (bridgeId, value) => setterCalls.push({ name: 'setRankupRules', args: [bridgeId, value] }),
        setRankupDemotionRules: (bridgeId, value) =>
          setterCalls.push({ name: 'setRankupDemotionRules', args: [bridgeId, value] }),
        setRankupExcludedRanks: (bridgeId, value) =>
          setterCalls.push({ name: 'setRankupExcludedRanks', args: [bridgeId, value] }),
        setRankupExcludedPlayers: (bridgeId, value) =>
          setterCalls.push({ name: 'setRankupExcludedPlayers', args: [bridgeId, value] })
      }
    })
    const body = JSON.stringify({
      enabled: true,
      manualReview: true,
      notificationCooldown: 12,
      notificationChannelIds: ['chan-1'],
      promotionRules: [{ targetRank: 'Officer', minWeeklyGexp: 5000, minDaysInGuild: 3, minOnlineHours: 1 }],
      demotionRules: [
        { fromRank: 'Officer', action: 'demote', targetRank: 'Member', maxWeeklyGexp: 500, gracePeriod: 3 }
      ],
      excludedRanks: ['Staff'],
      excludedPlayers: ['uuid-x']
    })
    const { response, handled } = await runHandler('PUT', '/api/rankup/rules?bridgeId=a', harness, body)
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    const names = setterCalls.map((call) => call.name)
    assert.deepStrictEqual(names, [
      'setRankupEnabled',
      'setRankupManualReview',
      'setRankupNotificationCooldown',
      'setRankupNotificationChannelIds',
      'setRankupRules',
      'setRankupDemotionRules',
      'setRankupExcludedRanks',
      'setRankupExcludedPlayers'
    ])
  })

  await it('POST /api/rankup/pending/:id/approve dispatches the action and returns success', async () => {
    const review: PendingReview = {
      id: 1,
      bridgeId: 'a',
      uuid: 'u1',
      currentRank: 'Member',
      proposedRank: 'Officer',
      action: 'promote',
      reason: 'r',
      createdAt: 1,
      notifiedAt: undefined
    }
    const removedIds: number[] = []
    const harness = await setupTest({
      pendingReviewManager: {
        getReview: () => review,
        removeReview: (id: number) => {
          removedIds.push(id)
        }
      }
    })
    harness.rankupManager.approveReview = async (bridgeId: string, id: number) => {
      harness.rankupManager.approveCalls.push({ bridgeId, id })
    }
    const { response, handled } = await runHandler('POST', '/api/rankup/pending/1/approve', harness, '')
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(harness.rankupManager.approveCalls, [{ bridgeId: 'a', id: 1 }])
    assert.deepStrictEqual(removedIds, [])
  })

  await it('POST /api/rankup/pending/:id/reject logs history and removes the review', async () => {
    const review: PendingReview = {
      id: 2,
      bridgeId: 'a',
      uuid: 'u1',
      currentRank: 'Member',
      proposedRank: 'Officer',
      action: 'promote',
      reason: 'r',
      createdAt: 1,
      notifiedAt: undefined
    }
    const historyCalls: unknown[][] = []
    const removedIds: number[] = []
    const harness = await setupTest({
      pendingReviewManager: {
        getReview: () => review,
        removeReview: (id: number) => {
          removedIds.push(id)
        },
        logHistory: (...arguments_: unknown[]) => {
          historyCalls.push(arguments_)
        }
      }
    })
    const { response, handled } = await runHandler('POST', '/api/rankup/pending/2/reject', harness, '')
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(historyCalls.length, 1)
    assert.strictEqual(historyCalls[0]?.[0], 'a')
    assert.strictEqual(historyCalls[0]?.[1], 'u1')
    assert.strictEqual(historyCalls[0]?.[2], 'reject')
    assert.strictEqual(historyCalls[0]?.[3], 'Member')
    assert.strictEqual(historyCalls[0]?.[4], 'Officer')
    assert.strictEqual(historyCalls[0]?.[5], 'web')
    assert.deepStrictEqual(removedIds, [2])
  })

  await it('POST /api/rankup/run-check kicks the task and records a timestamp', async () => {
    const harness = await setupTest()
    harness.rankupManager.runTaskForBridge = async (bridgeId: string) => {
      harness.rankupManager.runTaskCalls.push(bridgeId)
    }
    const before = Date.now()
    const { response, handled } = await runHandler(
      'POST',
      '/api/rankup/run-check',
      harness,
      JSON.stringify({ bridgeId: 'a' })
    )
    const after = Date.now()
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepStrictEqual(harness.rankupManager.runTaskCalls, ['a'])

    const statusResponse = await runHandler('GET', '/api/rankup/status?bridgeId=a', harness)
    const status = JSON.parse(statusResponse.response.body) as { lastCheckAt: number | null }
    assert.ok(status.lastCheckAt !== null)
    assert.ok(status.lastCheckAt >= before && status.lastCheckAt <= after)
  })

  await it('GET /api/rankup/history clamps limit to 200', async () => {
    const pendingReviewManager: FakePendingReviewManager = {
      getReviews: () => [],
      getReview: () => undefined,
      removeReview: () => {},
      logHistory: () => {},
      getHistory: () => [],
      getHistoryCalls: []
    }
    const originalGetHistory = pendingReviewManager.getHistory
    pendingReviewManager.getHistory = (bridgeId: string, limit: number) => {
      pendingReviewManager.getHistoryCalls.push({ bridgeId, limit })
      return originalGetHistory(bridgeId, limit)
    }
    const harness = await setupTest({ pendingReviewManager })
    const { response, handled } = await runHandler('GET', '/api/rankup/history?bridgeId=a&limit=999', harness)
    assert.strictEqual(handled, true)
    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(pendingReviewManager.getHistoryCalls.length, 1)
    assert.strictEqual(pendingReviewManager.getHistoryCalls[0]?.limit, 200)
  })
})
