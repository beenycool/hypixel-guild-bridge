import assert from 'node:assert'
import { describe, it } from 'node:test'

import type Application from '../src/application.js'
import { BridgeResolver } from '../src/common/bridge-resolver.js'
import { DatabaseManager } from '../src/common/database-manager.js'
import { ConfigurationsManager } from '../src/core/configurations.js'
import { BridgeConfigurations } from '../src/core/discord/bridge-configurations.js'

interface FakeApplication {
  applicationIntegrity: { addConfigPath: () => void }
  addShutdownListener: (listener: () => void | Promise<void>) => void
  getDatabaseConfig: () => { url: string }
  getConfigFilePath: (name: string) => string
}

function createFakeApplication(databaseUrl: string): FakeApplication {
  return {
    applicationIntegrity: {
      addConfigPath: () => {
        /* noop */
      }
    },
    addShutdownListener: () => {
      /* noop */
    },
    getDatabaseConfig: () => ({ url: databaseUrl }),
    getConfigFilePath: (name: string) => `/tmp/nonexistent-${name}`
  }
}

await describe('bridge message routing', async () => {
  await it('routes MC instance A chat only to Discord channel A, not channel B', async () => {
    const fakeApp = createFakeApplication('memory://routing-isolation-test')
    const databaseManager = new DatabaseManager(
      fakeApp as unknown as Application,
      {
        debug: () => {
          /* noop */
        },
        info: () => {
          /* noop */
        },
        warn: () => {
          /* noop */
        },
        error: () => {
          /* noop */
        }
      } as unknown as ConstructorParameters<typeof DatabaseManager>[1]
    )
    await databaseManager.awaitReady()
    await databaseManager.runMigrations()

    const configs = new ConfigurationsManager(databaseManager)
    const bridgeCfg = new BridgeConfigurations(configs)

    // Configure bridge A: bot1 -> channel-a
    bridgeCfg.addBridgeId('bridge-a')
    bridgeCfg.setMinecraftInstances('bridge-a', ['bot1'])
    bridgeCfg.setPublicChannelIds('bridge-a', ['channel-a'])

    // Configure bridge B: bot2 -> channel-b
    bridgeCfg.addBridgeId('bridge-b')
    bridgeCfg.setMinecraftInstances('bridge-b', ['bot2'])
    bridgeCfg.setPublicChannelIds('bridge-b', ['channel-b'])

    await databaseManager.flushWrites()

    const readerConfigs = new ConfigurationsManager(databaseManager)
    const readerBridgeCfg = new BridgeConfigurations(readerConfigs)
    const resolver = new BridgeResolver(undefined)
    resolver.setDynamicConfig(readerBridgeCfg)
    await readerConfigs.load()
    resolver.rebuildLookupMaps()

    // Verify isolation: bot1 -> channel-a only
    const bridgeIdA = resolver.getBridgeIdForInstance('bot1')
    assert.strictEqual(bridgeIdA, 'bridge-a')
    const channelsA = resolver.getPublicChannelIds(bridgeIdA)
    assert.deepStrictEqual(channelsA, ['channel-a'])

    // Verify isolation: bot2 -> channel-b only
    const bridgeIdB = resolver.getBridgeIdForInstance('bot2')
    assert.strictEqual(bridgeIdB, 'bridge-b')
    const channelsB = resolver.getPublicChannelIds(bridgeIdB)
    assert.deepStrictEqual(channelsB, ['channel-b'])

    // Verify cross-contamination: bridge A does not see channel B
    assert.strictEqual(resolver.getBridgeIdForChannel('channel-b'), 'bridge-b')
    assert.notStrictEqual(resolver.getBridgeIdForChannel('channel-b'), bridgeIdA)

    await databaseManager.close()
  })

  await it('propagates config changes after updating bridge channel mapping', async () => {
    const fakeApp = createFakeApplication('memory://routing-config-change-test')
    const databaseManager = new DatabaseManager(
      fakeApp as unknown as Application,
      {
        debug: () => {
          /* noop */
        },
        info: () => {
          /* noop */
        },
        warn: () => {
          /* noop */
        },
        error: () => {
          /* noop */
        }
      } as unknown as ConstructorParameters<typeof DatabaseManager>[1]
    )
    await databaseManager.awaitReady()
    await databaseManager.runMigrations()

    const configs = new ConfigurationsManager(databaseManager)
    const bridgeCfg = new BridgeConfigurations(configs)

    bridgeCfg.addBridgeId('bridge-a')
    bridgeCfg.setMinecraftInstances('bridge-a', ['bot1'])
    bridgeCfg.setPublicChannelIds('bridge-a', ['channel-a'])

    await databaseManager.flushWrites()

    const readerConfigs = new ConfigurationsManager(databaseManager)
    const readerBridgeCfg = new BridgeConfigurations(readerConfigs)
    const resolver = new BridgeResolver(undefined)
    resolver.setDynamicConfig(readerBridgeCfg)
    await readerConfigs.load()
    resolver.rebuildLookupMaps()

    // Before change: bot1 -> channel-a
    assert.deepStrictEqual(resolver.getPublicChannelIds('bridge-a'), ['channel-a'])

    // Update: bridge-a now points to channel-c
    bridgeCfg.setPublicChannelIds('bridge-a', ['channel-c'])
    await databaseManager.flushWrites()

    // Reload and rebuild
    await readerConfigs.load()
    resolver.rebuildLookupMaps()

    // After change: bot1 -> channel-c
    assert.deepStrictEqual(resolver.getPublicChannelIds('bridge-a'), ['channel-c'])
    assert.strictEqual(resolver.getBridgeIdForChannel('channel-a'), undefined)
    assert.strictEqual(resolver.getBridgeIdForChannel('channel-c'), 'bridge-a')

    await databaseManager.close()
  })

  await it('drops orphaned events when a bridge is removed', async () => {
    const fakeApp = createFakeApplication('memory://routing-orphan-test')
    const databaseManager = new DatabaseManager(
      fakeApp as unknown as Application,
      {
        debug: () => {
          /* noop */
        },
        info: () => {
          /* noop */
        },
        warn: () => {
          /* noop */
        },
        error: () => {
          /* noop */
        }
      } as unknown as ConstructorParameters<typeof DatabaseManager>[1]
    )
    await databaseManager.awaitReady()
    await databaseManager.runMigrations()

    const configs = new ConfigurationsManager(databaseManager)
    const bridgeCfg = new BridgeConfigurations(configs)

    bridgeCfg.addBridgeId('bridge-a')
    bridgeCfg.setMinecraftInstances('bridge-a', ['bot1'])
    bridgeCfg.setPublicChannelIds('bridge-a', ['channel-a'])

    await databaseManager.flushWrites()

    const readerConfigs = new ConfigurationsManager(databaseManager)
    const readerBridgeCfg = new BridgeConfigurations(readerConfigs)
    const resolver = new BridgeResolver(undefined)
    resolver.setDynamicConfig(readerBridgeCfg)
    await readerConfigs.load()
    resolver.rebuildLookupMaps()

    // Sanity check: bot1 is routed
    assert.strictEqual(resolver.getBridgeIdForInstance('bot1'), 'bridge-a')
    assert.strictEqual(resolver.getBridgeIdForChannel('channel-a'), 'bridge-a')

    // Remove bridge-a
    bridgeCfg.removeBridgeId('bridge-a')
    await databaseManager.flushWrites()

    // Reload and rebuild
    await readerConfigs.load()
    resolver.rebuildLookupMaps()

    // After removal: bot1 resolves to nothing, channel-a resolves to nothing
    assert.strictEqual(resolver.getBridgeIdForInstance('bot1'), undefined)
    assert.strictEqual(resolver.getBridgeIdForChannel('channel-a'), undefined)
    // getPublicChannelIds for a non-existent bridge returns empty array
    assert.deepStrictEqual(resolver.getPublicChannelIds('bridge-a'), [])

    await databaseManager.close()
  })
})
