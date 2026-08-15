import assert from 'node:assert'
import { describe, it } from 'node:test'

import Application from '../src/application.js'

const noop = (): void => {}
const promiseCatch = (): (() => void) => noop

await describe('Application.start', async () => {
  await it('rebuilds bridge lookup maps before loading instances', async () => {
    const calls: string[] = []

    const application = {
      core: {
        awaitReady: () => {
          calls.push('core.awaitReady')
        },
        tournamentManager: {
          rehydrate: () => {
            calls.push('core.tournamentManager.rehydrate')
          }
        },
        bridgeConfigurations: {
          getAllBridgeIds: () => []
        }
      },
      bridgeResolver: {
        rebuildLookupMaps: () => {
          calls.push('bridgeResolver.rebuildLookupMaps')
        }
      },
      applyStoredLanguage: () => {
        calls.push('applyStoredLanguage')
      },
      minecraftManager: {
        loadInstances: () => {
          calls.push('minecraftManager.loadInstances')
        }
      },
      rootDirectory: '/tmp',
      getAllInstances: () => [],
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {}
      },
      errorHandler: {
        promiseCatch
      },
      randomChatter: {
        start: () => {}
      },
      config: { general: {} }
    }

    await Application.prototype.start.call(application as unknown as Application)

    assert.deepStrictEqual(calls, [
      'core.awaitReady',
      'core.tournamentManager.rehydrate',
      'bridgeResolver.rebuildLookupMaps',
      'applyStoredLanguage',
      'minecraftManager.loadInstances'
    ])
  })
})
