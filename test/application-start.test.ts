import assert from 'node:assert'
import { describe, it } from 'node:test'

import Application from '../src/application.js'

await describe('Application.start', async () => {
  await it('rebuilds bridge lookup maps before loading instances', async () => {
    const calls: string[] = []

    const application = {
      core: {
        awaitReady: () => {
          calls.push('core.awaitReady')
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
      pluginsManager: {
        loadPlugins: () => {
          calls.push('pluginsManager.loadPlugins')
        }
      },
      rootDirectory: '/tmp',
      getAllInstances: () => [],
      logger: {
        debug: () => {
          /* noop */
        }
      },
      errorHandler: {
        promiseCatch: () => () => {
          /* noop */
        }
      },
      randomChatter: {
        start: () => {
          /* noop */
        }
      },
      config: { general: {} }
    }

    await Application.prototype.start.call(application as unknown as Application)

    assert.deepStrictEqual(calls, [
      'core.awaitReady',
      'bridgeResolver.rebuildLookupMaps',
      'applyStoredLanguage',
      'minecraftManager.loadInstances',
      'pluginsManager.loadPlugins'
    ])
  })
})
