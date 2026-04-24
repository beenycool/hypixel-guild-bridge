import assert from 'node:assert'
import { describe, it } from 'node:test'

import { RankupManager } from '../src/core/rankup/rankup-manager.js'

void describe('RankupManager executeAction', () => {
  void it('uses setrank for promotion targets', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const manager = {
      application: {
        mojangApi: {
          profileByUuid: async () => ({ name: 'PromotedPlayer' })
        },
        minecraftManager: {
          getAllInstances: () => [
            {
              instanceName: 'bot-a',
              send: (command: string) => {
                sentCommands.push(command)
              }
            }
          ]
        }
      },
      pendingManager: {
        logHistory: (...arguments_: unknown[]) => {
          historyEntries.push(arguments_)
        }
      },
      logger: {
        warn: () => {}
      }
    }

    await (RankupManager.prototype as any).executeAction.call(manager, 'bridge-a', 'bot-a', 'uuid-1', {
      action: 'promote',
      targetRank: 'Officer'
    })

    assert.deepStrictEqual(sentCommands, ['/g setrank PromotedPlayer Officer'])
    assert.strictEqual(historyEntries[0]?.[2], 'promote')
    assert.strictEqual(historyEntries[0]?.[4], 'Officer')
  })

  void it('uses setrank for demotion targets', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const manager = {
      application: {
        mojangApi: {
          profileByUuid: async () => ({ name: 'DemotedPlayer' })
        },
        minecraftManager: {
          getAllInstances: () => [
            {
              instanceName: 'bot-a',
              send: (command: string) => {
                sentCommands.push(command)
              }
            }
          ]
        }
      },
      pendingManager: {
        logHistory: (...arguments_: unknown[]) => {
          historyEntries.push(arguments_)
        }
      },
      logger: {
        warn: () => {}
      }
    }

    await (RankupManager.prototype as any).executeAction.call(manager, 'bridge-a', 'bot-a', 'uuid-2', {
      action: 'demote',
      targetRank: 'Member'
    })

    assert.deepStrictEqual(sentCommands, ['/g setrank DemotedPlayer Member'])
    assert.strictEqual(historyEntries[0]?.[2], 'demote')
    assert.strictEqual(historyEntries[0]?.[4], 'Member')
  })
})
