import assert from 'node:assert'
import { describe, it } from 'node:test'

import Application from '../src/application.js'

void describe('Application.start', () => {
  void it('rebuilds bridge lookup maps before loading instances', async () => {
    const calls: string[] = []

    const application = {
      core: {
        awaitReady: async () => {
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
        loadPlugins: async () => {
          calls.push('pluginsManager.loadPlugins')
        }
      },
      rootDirectory: '/tmp',
      getAllInstances: () => [],
      logger: { debug: () => {} },
      config: { general: { shareMetrics: false } }
    }

    await Application.prototype.start.call(application as any)

    assert.deepStrictEqual(calls, [
      'core.awaitReady',
      'bridgeResolver.rebuildLookupMaps',
      'applyStoredLanguage',
      'minecraftManager.loadInstances',
      'pluginsManager.loadPlugins'
    ])
  })
})
