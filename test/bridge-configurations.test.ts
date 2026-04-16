import assert from 'node:assert'

import { DatabaseManager } from '../src/common/database-manager'
import { ConfigurationsManager } from '../src/core/configurations'
import { BridgeConfigurations } from '../src/core/discord/bridge-configurations'
import { initializeCoreDatabase } from '../src/core/initialize-database'

// Minimal fake logger
const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
} as unknown as ConstructorParameters<typeof DatabaseManager>[1]

// Minimal fake application with expected hooks used by DatabaseManager
const fakeApp: any = {
  applicationIntegrity: { addConfigPath: () => {} },
  addShutdownListener: () => {},
  getDatabaseConfig: () => ({ url: 'memory://bridge-config-test' }),
  getConfigFilePath: (name: string) => `/tmp/nonexistent-${name}`
}

const databaseManager = new DatabaseManager(fakeApp, logger)

await initializeCoreDatabase(databaseManager)

const configs = new ConfigurationsManager(databaseManager)
const bridgeCfg = new BridgeConfigurations(configs)
await configs.load()

const bridgeId = 'bridge-test'

// default should be true
assert.strictEqual(bridgeCfg.getSkyblockEventsEnabled(bridgeId), true)

bridgeCfg.setSkyblockEventsEnabled(bridgeId, false)
assert.strictEqual(bridgeCfg.getSkyblockEventsEnabled(bridgeId), false)

// Notifiers default -> undefined
assert.strictEqual(bridgeCfg.getSkyblockEventNotifiers(bridgeId), undefined)

bridgeCfg.setSkyblockEventNotifier(bridgeId, 'BANK_INTEREST', false)
const notifiers = bridgeCfg.getSkyblockEventNotifiers(bridgeId)
assert.ok(notifiers)
assert.strictEqual(notifiers.BANK_INTEREST, false)

bridgeCfg.setSkyblockEventNotifier(bridgeId, 'BANK_INTEREST', true)
const notifiers2 = bridgeCfg.getSkyblockEventNotifiers(bridgeId)
assert.strictEqual(notifiers2!.BANK_INTEREST, true)

bridgeCfg.deleteSkyblockNotifiers(bridgeId)
assert.strictEqual(bridgeCfg.getSkyblockEventNotifiers(bridgeId), undefined)

// Persist guild online/offline getter/setter
assert.strictEqual(bridgeCfg.getPersistGuildOnlineOffline(bridgeId), false)
bridgeCfg.setPersistGuildOnlineOffline(bridgeId, true)
assert.strictEqual(bridgeCfg.getPersistGuildOnlineOffline(bridgeId), true)
bridgeCfg.setPersistGuildOnlineOffline(bridgeId, false)
assert.strictEqual(bridgeCfg.getPersistGuildOnlineOffline(bridgeId), false)

// Removal cleans up persist key
bridgeCfg.setPersistGuildOnlineOffline(bridgeId, true)
bridgeCfg.addBridgeId(bridgeId)
bridgeCfg.removeBridgeId(bridgeId)
assert.strictEqual(bridgeCfg.getPersistGuildOnlineOffline(bridgeId), false)

// Language getter/setter
assert.strictEqual(bridgeCfg.getLanguage(bridgeId), undefined)
bridgeCfg.setLanguage(bridgeId, 'de')
assert.strictEqual(bridgeCfg.getLanguage(bridgeId), 'de')
bridgeCfg.setLanguage(bridgeId, undefined)
assert.strictEqual(bridgeCfg.getLanguage(bridgeId), undefined)

// Owner roles and migration
assert.deepStrictEqual(bridgeCfg.getOwnerRoleIds(bridgeId), [])
bridgeCfg.setOwnerRoleIds(bridgeId, ['owner1'])
assert.deepStrictEqual(bridgeCfg.getOwnerRoleIds(bridgeId), ['owner1'])

const bridgeIdMigrate = 'bridge-migrate'
// Directly set legacy adminRoleIds in the configuration to test migration

;(bridgeCfg as any).configuration.setStringArray(`${bridgeIdMigrate}_adminRoleIds`, ['legacyAdmin'])

// getOwnerRoleIds should migrate it
assert.deepStrictEqual(bridgeCfg.getOwnerRoleIds(bridgeIdMigrate), ['legacyAdmin'])
// Should also have saved it to the new key
assert.deepStrictEqual(bridgeCfg.getOwnerRoleIds(bridgeIdMigrate), ['legacyAdmin'])

// Removal cleans up language key
bridgeCfg.setLanguage(bridgeId, 'ar')
bridgeCfg.addBridgeId(bridgeId)
bridgeCfg.removeBridgeId(bridgeId)
assert.strictEqual(bridgeCfg.getLanguage(bridgeId), undefined)
// And owner/admin roles
assert.deepStrictEqual(bridgeCfg.getOwnerRoleIds(bridgeId), [])

await databaseManager.flushWrites()
await databaseManager.close()

console.log('PASS: BridgeConfigurations DB getters/setters')
