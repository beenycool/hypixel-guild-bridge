import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { Logger } from 'log4js'

import type Application from '../src/application.js'
import { ActionDispatcher } from '../src/core/rankup/action-dispatcher.js'
import type { PendingReviewManager } from '../src/core/rankup/pending-review-manager.js'
import type { RankupDecision } from '../src/core/rankup/rankup-decision.js'

interface FakeMinecraftInstance {
  instanceName: string
  send: (command: string) => Promise<void>
}

function createFakeApplication(
  profile: { name: string; id: string } | 'fail',
  instances: FakeMinecraftInstance[]
): Application {
  return {
    mojangApi: {
      profileByUuid: () => (profile === 'fail' ? Promise.reject(new Error('API error')) : Promise.resolve(profile))
    },
    minecraftManager: {
      getAllInstances: () => instances
    }
  } as unknown as Application
}

function createPendingManager(logHistory: (...callArguments: unknown[]) => void = () => {}): PendingReviewManager {
  return {
    logHistory
  } as unknown as PendingReviewManager
}

function createLogger(overrides: Partial<Logger> = {}): Logger {
  return {
    error: () => {},
    warn: () => {},
    ...overrides
  } as unknown as Logger
}

await describe('ActionDispatcher', async () => {
  await it('sends promote command and logs history with real fromRank', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const dispatcher = new ActionDispatcher(
      createFakeApplication({ name: 'TestPlayer', id: 'uuid-1' }, [
        {
          instanceName: 'bot-a',
          send: (command: string) => {
            sentCommands.push(command)
            return Promise.resolve()
          }
        }
      ]),
      createPendingManager((...callArguments: unknown[]) => {
        historyEntries.push(callArguments)
      }),
      createLogger()
    )

    const decision: RankupDecision & { kind: 'promote' } = {
      kind: 'promote',
      uuid: 'uuid-1',
      currentRank: 'Member',
      targetRank: 'Officer',
      reason: 'Met requirements'
    }

    await dispatcher.dispatch('bridge-a', 'bot-a', decision, 'Member')

    assert.deepStrictEqual(sentCommands, ['/g setrank TestPlayer Officer'])
    assert.strictEqual(historyEntries[0]?.[0], 'bridge-a')
    assert.strictEqual(historyEntries[0]?.[1], 'uuid-1')
    assert.strictEqual(historyEntries[0]?.[2], 'promote')
    assert.strictEqual(historyEntries[0]?.[3], 'Member')
    assert.strictEqual(historyEntries[0]?.[4], 'Officer')
    assert.strictEqual(historyEntries[0]?.[5], 'System')
  })

  await it('sends demote command and logs history with real fromRank', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const dispatcher = new ActionDispatcher(
      createFakeApplication({ name: 'DemotedPlayer', id: 'uuid-2' }, [
        {
          instanceName: 'bot-a',
          send: (command: string) => {
            sentCommands.push(command)
            return Promise.resolve()
          }
        }
      ]),
      createPendingManager((...callArguments: unknown[]) => {
        historyEntries.push(callArguments)
      }),
      createLogger()
    )

    const decision: RankupDecision & { kind: 'demote' } = {
      kind: 'demote',
      uuid: 'uuid-2',
      currentRank: 'Officer',
      targetRank: 'Member',
      reason: 'Below requirements'
    }

    await dispatcher.dispatch('bridge-a', 'bot-a', decision, 'Officer')

    assert.deepStrictEqual(sentCommands, ['/g setrank DemotedPlayer Member'])
    assert.strictEqual(historyEntries[0]?.[2], 'demote')
    assert.strictEqual(historyEntries[0]?.[3], 'Officer')
    assert.strictEqual(historyEntries[0]?.[4], 'Member')
  })

  await it('sends kick command and logs history', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const dispatcher = new ActionDispatcher(
      createFakeApplication({ name: 'KickedPlayer', id: 'uuid-3' }, [
        {
          instanceName: 'bot-a',
          send: (command: string) => {
            sentCommands.push(command)
            return Promise.resolve()
          }
        }
      ]),
      createPendingManager((...callArguments: unknown[]) => {
        historyEntries.push(callArguments)
      }),
      createLogger()
    )

    const decision: RankupDecision & { kind: 'kick' } = {
      kind: 'kick',
      uuid: 'uuid-3',
      currentRank: 'Member',
      reason: 'Inactive too long'
    }

    await dispatcher.dispatch('bridge-a', 'bot-a', decision, 'Member')

    assert.deepStrictEqual(sentCommands, ['/g kick KickedPlayer Inactive too long'])
    assert.strictEqual(historyEntries[0]?.[2], 'kick')
    assert.strictEqual(historyEntries[0]?.[3], 'Member')
    assert.strictEqual(historyEntries[0]?.[4], 'Kick')
  })

  await it('aborts when profile lookup fails instead of falling back to uuid', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const dispatcher = new ActionDispatcher(
      createFakeApplication('fail', [
        {
          instanceName: 'bot-a',
          send: (command: string) => {
            sentCommands.push(command)
            return Promise.resolve()
          }
        }
      ]),
      createPendingManager((...callArguments: unknown[]) => {
        historyEntries.push(callArguments)
      }),
      createLogger()
    )

    const decision: RankupDecision & { kind: 'promote' } = {
      kind: 'promote',
      uuid: 'fallback-uuid',
      currentRank: 'Member',
      targetRank: 'Officer',
      reason: 'Met requirements'
    }

    await dispatcher.dispatch('bridge-a', 'bot-a', decision, 'Member')

    assert.strictEqual(sentCommands.length, 0)
    assert.strictEqual(historyEntries.length, 1)
    assert.strictEqual(historyEntries[0]?.[2], 'reject')
    assert.strictEqual(historyEntries[0]?.[3], 'Member')
    assert.strictEqual(historyEntries[0]?.[4], 'Member')
    assert.strictEqual(historyEntries[0]?.[5], 'System (API Error)')
  })

  await it('logs warning when instance not found', async () => {
    const warns: string[] = []

    const dispatcher = new ActionDispatcher(
      createFakeApplication({ name: 'TestPlayer', id: 'uuid-1' }, []),
      createPendingManager(),
      createLogger({
        warn: (message: string) => {
          warns.push(message)
        }
      })
    )

    const decision: RankupDecision & { kind: 'promote' } = {
      kind: 'promote',
      uuid: 'uuid-1',
      currentRank: 'Member',
      targetRank: 'Officer',
      reason: 'Met requirements'
    }

    await dispatcher.dispatch('bridge-a', 'nonexistent-bot', decision, 'Member')

    assert.ok(warns.length > 0)
    assert.ok(warns[0].includes('nonexistent-bot'))
  })
})
