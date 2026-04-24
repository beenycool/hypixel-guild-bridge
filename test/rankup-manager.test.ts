import assert from 'node:assert'
import { describe, it } from 'node:test'

import { RankupManager } from '../src/core/rankup/rankup-manager.js'

interface RankupManagerLike {
  application: {
    mojangApi: { profileByUuid: () => { name: string } }
    minecraftManager: { getAllInstances: () => { instanceName: string; send: (command: string) => void }[] }
  }
  pendingManager: { logHistory: (...logEntries: unknown[]) => void }
  logger: { warn: () => void }
}

type ExecuteActionFunction = (
  bridgeId: string,
  instanceName: string,
  uuid: string,
  result: { action: string; targetRank?: string; reason?: string }
) => Promise<void>

function callExecuteAction(
  manager: RankupManagerLike,
  bridgeId: string,
  instanceName: string,
  uuid: string,
  result: { action: string; targetRank?: string; reason?: string }
): Promise<void> {
  const executeFunction = (RankupManager.prototype as unknown as { executeAction: ExecuteActionFunction }).executeAction
  return executeFunction.call(manager, bridgeId, instanceName, uuid, result)
}

await describe('RankupManager executeAction', async () => {
  await it('uses setrank for promotion targets', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const manager: RankupManagerLike = {
      application: {
        mojangApi: {
          profileByUuid: () => ({ name: 'PromotedPlayer' })
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
        logHistory: (...logEntries: unknown[]) => {
          historyEntries.push(logEntries)
        }
      },
      logger: {
        warn: () => {
          /* noop */
        }
      }
    }

    await callExecuteAction(manager, 'bridge-a', 'bot-a', 'uuid-1', {
      action: 'promote',
      targetRank: 'Officer'
    })

    assert.deepStrictEqual(sentCommands, ['/g setrank PromotedPlayer Officer'])
    assert.strictEqual(historyEntries[0]?.[2], 'promote')
    assert.strictEqual(historyEntries[0]?.[4], 'Officer')
  })

  await it('uses setrank for demotion targets', async () => {
    const sentCommands: string[] = []
    const historyEntries: unknown[][] = []

    const manager: RankupManagerLike = {
      application: {
        mojangApi: {
          profileByUuid: () => ({ name: 'DemotedPlayer' })
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
        logHistory: (...logEntries: unknown[]) => {
          historyEntries.push(logEntries)
        }
      },
      logger: {
        warn: () => {
          /* noop */
        }
      }
    }

    await callExecuteAction(manager, 'bridge-a', 'bot-a', 'uuid-2', {
      action: 'demote',
      targetRank: 'Member'
    })

    assert.deepStrictEqual(sentCommands, ['/g setrank DemotedPlayer Member'])
    assert.strictEqual(historyEntries[0]?.[2], 'demote')
    assert.strictEqual(historyEntries[0]?.[4], 'Member')
  })
})
