import assert from 'node:assert'
import { describe, it } from 'node:test'

import { ActionDispatcher } from '../src/core/rankup/action-dispatcher.js'
import type { RankupDecision } from '../src/core/rankup/rankup-decision.js'

await describe('ActionDispatcher', async () => {
  await it('sends promote command and logs history with real fromRank', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const dispatcher = new ActionDispatcher(
      {
        mojangApi: {
          profileByUuid: () => Promise.resolve({ name: 'TestPlayer', id: 'uuid-1' })
        },
        minecraftManager: {
          getAllInstances: () => [
            {
              instanceName: 'bot-a',
              send: async (command: string) => {
                sentCommands.push(command)
              }
            }
          ]
        }
      } as any,
      {
        logHistory: (...arguments_: unknown[]) => {
          historyEntries.push(arguments_)
        }
      } as any,
      {
        warn: () => {
          /* noop */
        }
      } as any
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
      {
        mojangApi: {
          profileByUuid: () => Promise.resolve({ name: 'DemotedPlayer', id: 'uuid-2' })
        },
        minecraftManager: {
          getAllInstances: () => [
            {
              instanceName: 'bot-a',
              send: async (command: string) => {
                sentCommands.push(command)
              }
            }
          ]
        }
      } as any,
      {
        logHistory: (...arguments_: unknown[]) => {
          historyEntries.push(arguments_)
        }
      } as any,
      {
        warn: () => {
          /* noop */
        }
      } as any
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
      {
        mojangApi: {
          profileByUuid: () => Promise.resolve({ name: 'KickedPlayer', id: 'uuid-3' })
        },
        minecraftManager: {
          getAllInstances: () => [
            {
              instanceName: 'bot-a',
              send: async (command: string) => {
                sentCommands.push(command)
              }
            }
          ]
        }
      } as any,
      {
        logHistory: (...arguments_: unknown[]) => {
          historyEntries.push(arguments_)
        }
      } as any,
      {
        warn: () => {
          /* noop */
        }
      } as any
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
      {
        mojangApi: {
          profileByUuid: () => Promise.reject(new Error('API error'))
        },
        minecraftManager: {
          getAllInstances: () => [
            {
              instanceName: 'bot-a',
              send: async (command: string) => {
                sentCommands.push(command)
              }
            }
          ]
        }
      } as any,
      {
        logHistory: (...arguments_: unknown[]) => {
          historyEntries.push(arguments_)
        }
      } as any,
      {
        error: () => {
          /* noop */
        },
        warn: () => {
          /* noop */
        }
      } as any
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
      {
        mojangApi: {
          profileByUuid: () => Promise.resolve({ name: 'TestPlayer', id: 'uuid-1' })
        },
        minecraftManager: {
          getAllInstances: () => []
        }
      } as any,
      {
        logHistory: () => {
          /* noop */
        }
      } as any,
      {
        warn: (message: string) => {
          warns.push(message)
        }
      } as any
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
