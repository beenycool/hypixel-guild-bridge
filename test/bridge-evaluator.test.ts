import assert from 'node:assert'
import { describe, it } from 'node:test'

import { BridgeEvaluator } from '../src/core/rankup/bridge-evaluator.js'

await describe('BridgeEvaluator', async () => {
  const baseGuild = {
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

  const baseLogger = {
    info: () => {
      /* noop */
    },
    error: () => {
      /* noop */
    },
    warn: () => {
      /* noop */
    }
  }

  function createFakeApplication(members: any[]) {
    return {
      hypixelApi: {
        getGuild: async () => ({
          ...baseGuild,
          members
        })
      },
      minecraftManager: {
        getAllInstances: () => [{ instanceName: 'bot-a', uuid: () => 'mock-uuid' }]
      },
      core: {
        databaseManager: {
          queryRows: async () => []
        },
        inactivity: {
          getActiveByUuid: () => undefined
        }
      }
    } as any
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
      {
        ...baseBridgeConfig,
        getRankupRules: () => [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }]
      } as any,
      {
        removeReviewByUuid: () => {
          /* noop */
        },
        clearReviewsNotInList: () => {
          /* noop */
        },
        getReviews: () => [],
        updateNotifiedAt: () => {
          /* noop */
        }
      } as any,
      {} as any,
      {
        dispatch: async (...arguments_: unknown[]) => {
          dispatchCalls.push(arguments_)
        }
      } as any,
      baseLogger as any
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
      {
        ...baseBridgeConfig,
        getRankupDemotionRules: () => [
          { fromRank: 'Officer', action: 'demote', targetRank: 'Member', maxWeeklyGexp: 10_000, gracePeriod: 7 }
        ]
      } as any,
      {
        removeReviewByUuid: () => {
          /* noop */
        },
        clearReviewsNotInList: () => {
          /* noop */
        },
        getReviews: () => [],
        updateNotifiedAt: () => {
          /* noop */
        }
      } as any,
      {} as any,
      {
        dispatch: async (...arguments_: unknown[]) => {
          dispatchCalls.push(arguments_)
        }
      } as any,
      baseLogger as any
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
      {
        ...baseBridgeConfig,
        getRankupRules: () => [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }],
        getRankupExcludedPlayers: () => ['uuid-excluded']
      } as any,
      {
        removeReviewByUuid: (bridgeId: string, uuid: string) => {
          removeReviewCalls.push(uuid)
        },
        clearReviewsNotInList: () => {
          /* noop */
        },
        getReviews: () => [],
        updateNotifiedAt: () => {
          /* noop */
        }
      } as any,
      {} as any,
      {
        dispatch: async (...arguments_: unknown[]) => {
          dispatchCalls.push(arguments_)
        }
      } as any,
      baseLogger as any
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
      {
        ...baseBridgeConfig,
        getRankupRules: () => [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }]
      } as any,
      {
        removeReviewByUuid: () => {
          /* noop */
        },
        clearReviewsNotInList: () => {
          /* noop */
        },
        getReviews: () => [],
        updateNotifiedAt: () => {
          /* noop */
        }
      } as any,
      {} as any,
      {
        dispatch: async (...arguments_: unknown[]) => {
          dispatchCalls.push(arguments_)
        }
      } as any,
      baseLogger as any
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
      {
        ...baseBridgeConfig,
        getRankupRules: () => [{ targetRank: 'Officer', minWeeklyGexp: 10_000, minDaysInGuild: 7, minOnlineHours: 0 }],
        getRankupManualReview: () => true
      } as any,
      {
        removeReviewByUuid: () => {
          /* noop */
        },
        addReview: (...arguments_: unknown[]) => {
          addReviewCalls.push(arguments_)
        },
        clearReviewsNotInList: () => {
          /* noop */
        },
        getReviews: () => [],
        updateNotifiedAt: () => {
          /* noop */
        }
      } as any,
      {} as any,
      {
        dispatch: async (...arguments_: unknown[]) => {
          dispatchCalls.push(arguments_)
        }
      } as any,
      baseLogger as any
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
      {
        ...baseBridgeConfig,
        getRankupDemotionRules: () => [
          { fromRank: 'Officer', action: 'notify', maxWeeklyGexp: 10_000, gracePeriod: 7 }
        ],
        getRankupManualReview: () => true
      } as any,
      {
        removeReviewByUuid: () => {
          /* noop */
        },
        addReview: (...arguments_: unknown[]) => {
          addReviewCalls.push(arguments_)
        },
        clearReviewsNotInList: () => {
          /* noop */
        },
        getReviews: () => [],
        updateNotifiedAt: () => {
          /* noop */
        }
      } as any,
      {
        sendNotifyOnly: async (...arguments_: unknown[]) => {
          sendNotifyCalls.push(arguments_)
        }
      } as any,
      {
        dispatch: async (...arguments_: unknown[]) => {
          dispatchCalls.push(arguments_)
        }
      } as any,
      baseLogger as any
    )

    await evaluator.processBridge('bridge-a')

    assert.strictEqual(dispatchCalls.length, 0)
    assert.strictEqual(addReviewCalls.length, 0)
    assert.strictEqual(sendNotifyCalls.length, 1)
  })
})
