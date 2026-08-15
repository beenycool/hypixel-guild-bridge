import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import type { Logger } from 'log4js'
import type { WebSocket } from 'ws'

import type Application from '../src/application.js'
import type { PendingReview, RankupHistoryEntry } from '../src/core/rankup/pending-review-manager.js'
import { RankupWsEvents } from '../src/instance/web/rankup-ws-events.js'

interface FakeSocket extends EventEmitter {
  sentMessages: string[]
  readyState: number
  send(data: string): void
}

function createFakeSocket(): FakeSocket {
  // eslint-disable-next-line unicorn/prefer-event-target -- fake mimics the ws WebSocket API, which is EventEmitter-based
  const socket = new EventEmitter() as FakeSocket
  socket.sentMessages = []
  socket.readyState = 1
  socket.send = (data: string) => {
    socket.sentMessages.push(data)
  }
  return socket
}

function asWs(socket: FakeSocket): WebSocket {
  return socket as unknown as WebSocket
}

interface FakeAppOptions {
  bridgeIds?: string[]
  reviewsByBridge?: Map<string, PendingReview[]>
  historyByBridge?: Map<string, RankupHistoryEntry[]>
}

function createFakeApplication(options: FakeAppOptions = {}): {
  app: Application
  eventEmitter: EventEmitter
  reviewsByBridge: Map<string, PendingReview[]>
  historyByBridge: Map<string, RankupHistoryEntry[]>
  bridgeIds: string[]
} {
  // eslint-disable-next-line unicorn/prefer-event-target -- fake app event bus must expose .on() like the real Application
  const eventEmitter = new EventEmitter()
  const reviewsByBridge = options.reviewsByBridge ?? new Map<string, PendingReview[]>()
  const historyByBridge = options.historyByBridge ?? new Map<string, RankupHistoryEntry[]>()
  const bridgeIds = options.bridgeIds ?? []

  const app = {
    on: (event: string, callback: (data: unknown) => void) => {
      eventEmitter.on(event, callback)
    },
    core: {
      bridgeConfigurations: {
        getAllBridgeIds: () => bridgeIds
      },
      pendingReviewManager: {
        getReviews: (bridgeId: string) => reviewsByBridge.get(bridgeId) ?? [],
        getHistory: (bridgeId: string, limit: number) => (historyByBridge.get(bridgeId) ?? []).slice(0, limit)
      }
    }
  } as unknown as Application

  return { app, eventEmitter, reviewsByBridge, historyByBridge, bridgeIds }
}

const noop = (): void => {}

const silentLogger: Logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  level: 'off',
  isLevelEnabled: () => false,
  log: noop,
  setLevel: noop,
  getLevel: () => 'off'
} as unknown as Logger

await describe('RankupWsEvents', async () => {
  await it('tick() returns 0 as a no-op', () => {
    const { app } = createFakeApplication({ bridgeIds: [] })
    const events = new RankupWsEvents(app, silentLogger)
    const count = events.tick()
    assert.strictEqual(count, 0)
  })

  await it('pendingReviewAdded event broadcasts reviewAdded to subscribers', async () => {
    const { app, eventEmitter } = createFakeApplication({ bridgeIds: ['a'] })
    const events = new RankupWsEvents(app, silentLogger)
    const socket = createFakeSocket()
    events.subscribe(asWs(socket))

    socket.sentMessages = []

    const review: PendingReview = {
      id: 1,
      bridgeId: 'a',
      uuid: 'uuid-1',
      currentRank: 'Member',
      proposedRank: 'Officer',
      action: 'promote',
      reason: 'met requirements',
      createdAt: 100,
      notifiedAt: undefined
    }

    eventEmitter.emit('pendingReviewAdded', { bridgeId: 'a', review })

    await new Promise((resolve) => setImmediate(resolve))

    assert.strictEqual(socket.sentMessages.length, 1)
    const payload = JSON.parse(socket.sentMessages[0]) as { type: string; data: PendingReview }
    assert.strictEqual(payload.type, 'rankup.reviewAdded')
    assert.strictEqual(payload.data.id, 1)
    assert.strictEqual(payload.data.bridgeId, 'a')
    assert.strictEqual(payload.data.uuid, 'uuid-1')
    assert.strictEqual(payload.data.currentRank, 'Member')
    assert.strictEqual(payload.data.proposedRank, 'Officer')
  })

  await it('pendingReviewRemoved event broadcasts reviewRemoved to subscribers', () => {
    const { app, eventEmitter } = createFakeApplication({ bridgeIds: ['a'] })
    const events = new RankupWsEvents(app, silentLogger)
    const socket = createFakeSocket()
    events.subscribe(asWs(socket))

    socket.sentMessages = []

    eventEmitter.emit('pendingReviewRemoved', { bridgeId: 'a', id: 1 })

    assert.strictEqual(socket.sentMessages.length, 1)
    const payload = JSON.parse(socket.sentMessages[0]) as { type: string; data: unknown }
    assert.strictEqual(payload.type, 'rankup.reviewRemoved')
    assert.deepStrictEqual(payload.data, { bridgeId: 'a', id: 1 })
  })

  await it('pendingHistoryAppended event broadcasts historyAppended to subscribers', async () => {
    const { app, eventEmitter } = createFakeApplication({ bridgeIds: ['a'] })
    const events = new RankupWsEvents(app, silentLogger)
    const socket = createFakeSocket()
    events.subscribe(asWs(socket))

    socket.sentMessages = []

    const entry: RankupHistoryEntry = {
      id: 1,
      bridgeId: 'a',
      uuid: 'uuid-1',
      action: 'promote',
      fromRank: 'Member',
      toRank: 'Officer',
      triggeredBy: 'System',
      createdAt: 100
    }

    eventEmitter.emit('pendingHistoryAppended', { bridgeId: 'a', entry })

    await new Promise((resolve) => setImmediate(resolve))

    assert.strictEqual(socket.sentMessages.length, 1)
    const payload = JSON.parse(socket.sentMessages[0]) as { type: string; data: RankupHistoryEntry }
    assert.strictEqual(payload.type, 'rankup.historyAppended')
    assert.deepStrictEqual(payload.data, entry)
  })

  await it('bridgeConfigChanged event triggers broadcast to subscribers', () => {
    const { app, eventEmitter } = createFakeApplication({ bridgeIds: ['a'] })
    const events = new RankupWsEvents(app, silentLogger)
    const socket = createFakeSocket()
    events.subscribe(asWs(socket))
    socket.sentMessages = []

    eventEmitter.emit('bridgeConfigChanged', { bridgeId: 'a', key: 'foo', value: 'bar' })

    assert.strictEqual(socket.sentMessages.length, 1)
    const payload = JSON.parse(socket.sentMessages[0]) as { type: string; data: unknown }
    assert.strictEqual(payload.type, 'rankup.bridgeConfigChanged')
    assert.deepStrictEqual(payload.data, { bridgeId: 'a' })
  })

  await it('subscribe / unsubscribe works as expected', () => {
    const { app, eventEmitter } = createFakeApplication({ bridgeIds: ['a'] })
    const events = new RankupWsEvents(app, silentLogger)
    const socketA = createFakeSocket()
    const socketB = createFakeSocket()
    events.subscribe(asWs(socketA))
    events.subscribe(asWs(socketB))
    socketA.sentMessages = []
    socketB.sentMessages = []

    eventEmitter.emit('bridgeConfigChanged', { bridgeId: 'a', key: 'foo', value: 'bar' })
    assert.strictEqual(socketA.sentMessages.length, 1)
    assert.strictEqual(socketB.sentMessages.length, 1)

    events.unsubscribe(asWs(socketA))
    eventEmitter.emit('bridgeConfigChanged', { bridgeId: 'a', key: 'foo', value: 'bar' })
    assert.strictEqual(socketA.sentMessages.length, 1)
    assert.strictEqual(socketB.sentMessages.length, 2)
  })

  await it('new event after subscribe broadcasts to subscribers', async () => {
    const { app, eventEmitter } = createFakeApplication({ bridgeIds: ['a'] })
    const events = new RankupWsEvents(app, silentLogger)
    const socket = createFakeSocket()
    events.subscribe(asWs(socket))

    socket.sentMessages = []

    const review: PendingReview = {
      id: 1,
      bridgeId: 'a',
      uuid: 'uuid-1',
      currentRank: 'Member',
      proposedRank: 'Officer',
      action: 'promote',
      reason: 'met requirements',
      createdAt: 100,
      notifiedAt: undefined
    }

    eventEmitter.emit('pendingReviewAdded', { bridgeId: 'a', review })

    await new Promise((resolve) => setImmediate(resolve))

    assert.strictEqual(socket.sentMessages.length, 1)
  })
})
