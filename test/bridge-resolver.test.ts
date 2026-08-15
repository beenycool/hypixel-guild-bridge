import assert from 'node:assert'
import { describe, it } from 'node:test'

import type Application from '../src/application.js'
import { BridgeResolver } from '../src/common/bridge-resolver.js'
import { DatabaseManager } from '../src/common/database-manager.js'
import { ConfigurationsManager } from '../src/core/configurations.js'
import { BridgeConfigurations } from '../src/core/discord/bridge-configurations.js'
import { initializeCoreDatabase } from '../src/core/initialize-database.js'

const Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
} as unknown as ConstructorParameters<typeof DatabaseManager>[1]

interface FakeApplication {
  applicationIntegrity: { addConfigPath: () => void }
  addShutdownListener: (listener: () => void | Promise<void>) => void
  getDatabaseConfig: () => { url: string }
  getConfigFilePath: (name: string) => string
}

function createFakeApplication(databaseUrl: string): FakeApplication {
  return {
    applicationIntegrity: {
      addConfigPath: () => {}
    },
    addShutdownListener: () => {},
    getDatabaseConfig: () => ({ url: databaseUrl }),
    getConfigFilePath: (name: string) => `/tmp/nonexistent-${name}`
  }
}

await describe('BridgeResolver', async () => {
  await it('loads persisted dynamic mappings after a rebuild once configs are loaded', async () => {
    const fakeApp = createFakeApplication('memory://bridge-resolver-startup-test')
    const databaseManager = new DatabaseManager(fakeApp as unknown as Application, Logger)
    await initializeCoreDatabase(databaseManager)

    const writerConfigurations = new ConfigurationsManager(databaseManager)
    const writerBridgeConfigurations = new BridgeConfigurations(writerConfigurations)
    writerBridgeConfigurations.addBridgeId('bridge-a')
    writerBridgeConfigurations.setMinecraftInstances('bridge-a', ['bot1'])
    writerBridgeConfigurations.setPublicChannelIds('bridge-a', ['public-1'])
    writerBridgeConfigurations.setLoggerChannelIds('bridge-a', ['logger-1'])
    await databaseManager.flushWrites()

    const readerConfigurations = new ConfigurationsManager(databaseManager)
    const readerBridgeConfigurations = new BridgeConfigurations(readerConfigurations)
    const resolver = new BridgeResolver(undefined)
    resolver.setDynamicConfig(readerBridgeConfigurations)

    assert.strictEqual(resolver.getBridgeIdForInstance('bot1'), undefined)
    assert.strictEqual(resolver.getBridgeIdForChannel('public-1'), undefined)
    assert.strictEqual(resolver.getBridgeIdForChannel('logger-1'), undefined)

    await readerConfigurations.load()
    resolver.rebuildLookupMaps()

    assert.strictEqual(resolver.getBridgeIdForInstance('BOT1'), 'bridge-a')
    assert.strictEqual(resolver.getBridgeIdForChannel('public-1'), 'bridge-a')
    assert.strictEqual(resolver.getBridgeIdForChannel('logger-1'), 'bridge-a')
    assert.strictEqual(resolver.getChannelTypeForChannel('logger-1'), 'logger')

    await databaseManager.close()
  })

  await it('updates logger channel mappings when lookup maps are rebuilt', () => {
    let loggerChannelIds = ['logger-old']

    const dynamicConfig = {
      getAllBridgeIds: () => ['bridge-a'],
      getMinecraftInstances: () => [],
      getPublicChannelIds: () => [],
      getOfficerChannelIds: () => [],
      getLoggerChannelIds: () => loggerChannelIds,
      getPromoteChannelIds: () => [],
      getChatSummaryChannelIds: () => [],
      getChatSummaryEnabled: () => false
    } as unknown as BridgeConfigurations

    const resolver = new BridgeResolver(undefined)
    resolver.setDynamicConfig(dynamicConfig)

    assert.strictEqual(resolver.getBridgeIdForChannel('logger-old'), 'bridge-a')
    assert.strictEqual(resolver.getChannelTypeForChannel('logger-old'), 'logger')

    loggerChannelIds = ['logger-new']
    resolver.rebuildLookupMaps()

    assert.strictEqual(resolver.getBridgeIdForChannel('logger-old'), undefined)
    assert.strictEqual(resolver.getBridgeIdForChannel('logger-new'), 'bridge-a')
    assert.strictEqual(resolver.getChannelTypeForChannel('logger-new'), 'logger')
  })
})
