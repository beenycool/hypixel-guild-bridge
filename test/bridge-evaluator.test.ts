import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { Logger } from 'log4js'

import type Application from '../src/application.js'
import type { BridgeConfigurations } from '../src/core/discord/bridge-configurations.js'
import type { ActionDispatcher } from '../src/core/rankup/action-dispatcher.js'
import { BridgeEvaluator } from '../src/core/rankup/bridge-evaluator.js'
import type { NotificationManager } from '../src/core/rankup/notification-manager.js'
import type { PendingReviewManager } from '../src/core/rankup/pending-review-manager.js'

interface FakeGuildMember {
  uuid: string
  rank: string
  joinedAt: Date
  weeklyExperience?: number
  expHistory?: { day: string; date: Date; exp: number; totalExp: number }[]
}

interface FakeGuild {
  ranks: { name: string; priority: number }[]
  members: FakeGuildMember[]
}

function createPendingManager(overrides: Partial<PendingReviewManager> = {}): PendingReviewManager {
  return {
    removeReviewByUuid: () => {},
    addReview: () => {},
    clearReviewsNotInList: () => {},
    getReviews: () => [],
    updateNotifiedAt: () => {},
    ...overrides
  } as unknown as PendingReviewManager
}

function createNotificationManager(overrides: Partial<NotificationManager> = {}): NotificationManager {
  return {
    sendReviewNotification: () => Promise.resolve(false),
    sendNotifyOnly: () => Promise.resolve(),
    ...overrides
  } as unknown as NotificationManager
}

function createActionDispatcher(dispatchCalls: unknown[][]): ActionDispatcher {
  return {
    dispatch: (...callArguments: unknown[]) => {
      dispatchCalls.push(callArguments)
      return Promise.resolve()
    }
  } as unknown as ActionDispatcher
}

await describe('BridgeEvaluator', async () => {
  const baseGuild: FakeGuild = {
    ranks: [
      { name: 'Member', priority: 0 },
      { name: 'Officer', priority: 1 },
      { name: 'Owner', priority: 2 }
    ],
    members: []
  }

  const baseBridgeConfig = {
    getMinecraftInstances: () => ['bot-a'],
    getRankupRules: () => [],
    getRankupDemotionRules: () => [],
    getRankupExcludedRanks: () => [],
    getRankupExcludedPlayers: () => [],
    getRankupManualReview: () => false,
    getOfficerChannelIds: () => [],
    getRankupNotificationChannelIds: () => [],
    getRankupNotificationCooldown: () => 24
  }

  const baseLogger: Logger = {
    info: () => {},
    error: () => {},
    warn: () => {}
  } as unknown as Logger

  function createFakeApplication(members: FakeGuildMember[]): Application {
    return {
      hypixelApi: {
        getGuild: () =>
          Promise.resolve({
            ...baseGuild,
            members
          })
      },
      minecraftManager: {
        getAllInstances: () => [{ instanceName: 'bot-a', uuid: () => 'mock-uuid' }]
      },
      core: {
        databaseManager: {
          queryRows: () => []
        },
        inactivity: {
          getActiveByUuid: () => undefined
        }
      }
    } as unknown as Application
  }

  function createBridgeConfig(
    overrides: Partial<
      Pick<
        BridgeConfigurations,
        | 'getMinecraftInstances'
        | 'getRankupRules'
        | 'getRankupDemotionRules'
        | 'getRankupExcludedRanks'
        | 'getRankupExcludedPlayers'
        | 'getRankupManualReview'
        | 'getOfficerChannelIds'
        | 'getRankupNotificationChannelIds'
        | 'getRankupNotificationCooldown'
      >
    > = {}
  ): BridgeConfigurations {
    return {
      ...baseBridgeConfig,
      ...overrides
    } as unknown as BridgeConfigurations
  }

  await it('dispatches promotion when member meets promotion rules', async () => {
    const dispatchCalls: unknown[][] = []

    const evaluator = new BridgeEvaluator(
      createFakeApplication([
        {
          uuid: 'uuid-promote',
          rank: 'Member',
          joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          weeklyExperience: 50_000,
          expHistory: [{ day: '2024-01-01', date: new Date('2024-01-01'), exp: 50_000, totalExp: 50_000 }]
        }
      ]),
      createBridgeConfig({
        getRankupRules: () => [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }]
      }),
      createPendingManager(),
      createNotificationManager(),
      createActionDispatcher(dispatchCalls),
      baseLogger
    )

    await evaluator.processBridge('bridge-a')

    assert.strictEqual(dispatchCalls.length, 1)
    const decision = (dispatchCalls[0] as [string, string, { kind: string }])[2]
    assert.strictEqual(decision.kind, 'promote')
  })

  await it('dispatches demotion when member meets demotion rules', async () => {
    const dispatchCalls: unknown[][] = []

    const evaluator = new BridgeEvaluator(
      createFakeApplication([
        {
          uuid: 'uuid-demote',
          rank: 'Officer',
          joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          expHistory: [{ day: '2024-01-01', date: new Date('2024-01-01'), exp: 500, totalExp: 500 }]
        }
      ]),
      createBridgeConfig({
        getRankupDemotionRules: () => [
          { fromRank: 'Officer', action: 'demote', targetRank: 'Member', maxWeeklyGexp: 10_000, gracePeriod: 7 }
        ]
      }),
      createPendingManager(),
      createNotificationManager(),
      createActionDispatcher(dispatchCalls),
      baseLogger
    )

    await evaluator.processBridge('bridge-a')

    assert.strictEqual(dispatchCalls.length, 1)
    const decision = (dispatchCalls[0] as [string, string, { kind: string }])[2]
    assert.strictEqual(decision.kind, 'demote')
  })

  await it('skips excluded players', async () => {
    const removeReviewCalls: string[] = []
    const dispatchCalls: unknown[][] = []

    const evaluator = new BridgeEvaluator(
      createFakeApplication([
        {
          uuid: 'uuid-excluded',
          rank: 'Member',
          joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          expHistory: [{ day: '2024-01-01', date: new Date('2024-01-01'), exp: 50_000, totalExp: 50_000 }]
        }
      ]),
      createBridgeConfig({
        getRankupRules: () => [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }],
        getRankupExcludedPlayers: () => ['uuid-excluded']
      }),
      createPendingManager({
        removeReviewByUuid: (bridgeId: string, uuid: string) => {
          removeReviewCalls.push(uuid)
        }
      }),
      createNotificationManager(),
      createActionDispatcher(dispatchCalls),
      baseLogger
    )

    await evaluator.processBridge('bridge-a')

    assert.strictEqual(dispatchCalls.length, 0)
    assert.strictEqual(removeReviewCalls.length, 1)
    assert.strictEqual(removeReviewCalls[0], 'uuid-excluded')
  })

  await it('skips members with unknown rank', async () => {
    const dispatchCalls: unknown[][] = []

    const evaluator = new BridgeEvaluator(
      createFakeApplication([
        {
          uuid: 'uuid-unknown-rank',
          rank: 'UnknownRank',
          joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          expHistory: [{ day: '2024-01-01', date: new Date('2024-01-01'), exp: 50_000, totalExp: 50_000 }]
        }
      ]),
      createBridgeConfig({
        getRankupRules: () => [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }]
      }),
      createPendingManager(),
      createNotificationManager(),
      createActionDispatcher(dispatchCalls),
      baseLogger
    )

    await evaluator.processBridge('bridge-a')

    assert.strictEqual(dispatchCalls.length, 0)
  })

  await it('adds review in manual review mode instead of dispatching', async () => {
    const addReviewCalls: unknown[][] = []
    const dispatchCalls: unknown[][] = []

    const evaluator = new BridgeEvaluator(
      createFakeApplication([
        {
          uuid: 'uuid-manual',
          rank: 'Member',
          joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          weeklyExperience: 50_000,
          expHistory: [{ day: '2024-01-01', date: new Date('2024-01-01'), exp: 50_000, totalExp: 50_000 }]
        }
      ]),
      createBridgeConfig({
        getRankupRules: () => [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }],
        getRankupManualReview: () => true
      }),
      createPendingManager({
        addReview: (...callArguments: unknown[]) => {
          addReviewCalls.push(callArguments)
        }
      }),
      createNotificationManager(),
      createActionDispatcher(dispatchCalls),
      baseLogger
    )

    await evaluator.processBridge('bridge-a')

    assert.strictEqual(dispatchCalls.length, 0)
    assert.strictEqual(addReviewCalls.length, 1)
    assert.strictEqual(addReviewCalls[0]?.[2], 'Member')
    assert.strictEqual(addReviewCalls[0]?.[3], 'Officer')
    assert.strictEqual(addReviewCalls[0]?.[4], 'promote')
  })

  await it('sends notify-only when action is notify', async () => {
    const dispatchCalls: unknown[][] = []
    const addReviewCalls: unknown[][] = []
    const sendNotifyCalls: unknown[][] = []

    const evaluator = new BridgeEvaluator(
      createFakeApplication([
        {
          uuid: 'uuid-notify',
          rank: 'Officer',
          joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          expHistory: [{ day: '2024-01-01', date: new Date('2024-01-01'), exp: 500, totalExp: 500 }]
        }
      ]),
      createBridgeConfig({
        getRankupDemotionRules: () => [
          { fromRank: 'Officer', action: 'notify', maxWeeklyGexp: 10_000, gracePeriod: 7 }
        ],
        getRankupManualReview: () => true
      }),
      createPendingManager(),
      createNotificationManager({
        sendNotifyOnly: (...callArguments: unknown[]) => {
          sendNotifyCalls.push(callArguments)
          return Promise.resolve()
        }
      }),
      createActionDispatcher(dispatchCalls),
      baseLogger
    )

    await evaluator.processBridge('bridge-a')

    assert.strictEqual(dispatchCalls.length, 0)
    assert.strictEqual(addReviewCalls.length, 0)
    assert.strictEqual(sendNotifyCalls.length, 1)
  })
})
