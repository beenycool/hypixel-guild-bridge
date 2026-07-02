import assert from 'node:assert'

import type Application from '../src/application.js'
import { DatabaseManager } from '../src/common/database-manager'
import { ConfigurationsManager } from '../src/core/configurations'
import type { Configuration } from '../src/core/configurations'
import { BridgeConfigurations } from '../src/core/discord/bridge-configurations'
import { initializeCoreDatabase } from '../src/core/initialize-database'

// Minimal fake logger
const Logger = {
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

// Minimal fake application with expected hooks used by DatabaseManager
const FakeApp: {
  applicationIntegrity: { addConfigPath: () => void }
  addShutdownListener: () => void
  getDatabaseConfig: () => { url: string }
  getConfigFilePath: (name: string) => string
} = {
  applicationIntegrity: {
    addConfigPath: () => {
      /* noop */
    }
  },
  addShutdownListener: () => {
    /* noop for test */
  },
  getDatabaseConfig: () => ({ url: 'memory://bridge-config-test' }),
  getConfigFilePath: (name: string) => `/tmp/nonexistent-${name}`
}

const DatabaseManagerInstance = new DatabaseManager(FakeApp as unknown as Application, Logger)

await initializeCoreDatabase(DatabaseManagerInstance)

const Configs = new ConfigurationsManager(DatabaseManagerInstance)
const BridgeCfg = new BridgeConfigurations(Configs)
await Configs.load()

const BridgeId = 'bridge-test'

// Persist guild online/offline getter/setter
assert.strictEqual(BridgeCfg.getPersistGuildOnlineOffline(BridgeId), false)
BridgeCfg.setPersistGuildOnlineOffline(BridgeId, true)
assert.strictEqual(BridgeCfg.getPersistGuildOnlineOffline(BridgeId), true)
BridgeCfg.setPersistGuildOnlineOffline(BridgeId, false)
assert.strictEqual(BridgeCfg.getPersistGuildOnlineOffline(BridgeId), false)

// Removal cleans up persist key
BridgeCfg.setPersistGuildOnlineOffline(BridgeId, true)
BridgeCfg.addBridgeId(BridgeId)
BridgeCfg.removeBridgeId(BridgeId)
assert.strictEqual(BridgeCfg.getPersistGuildOnlineOffline(BridgeId), false)

// Language getter/setter
assert.strictEqual(BridgeCfg.getLanguage(BridgeId), undefined)
BridgeCfg.setLanguage(BridgeId, 'de')
assert.strictEqual(BridgeCfg.getLanguage(BridgeId), 'de')
BridgeCfg.setLanguage(BridgeId, undefined)
assert.strictEqual(BridgeCfg.getLanguage(BridgeId), undefined)

// Owner roles and migration
assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeId), [])
BridgeCfg.setOwnerRoleIds(BridgeId, ['owner1'])
assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeId), ['owner1'])

const BridgeIdMigrate = 'bridge-migrate'
// Directly set legacy adminRoleIds in the configuration to test migration

;(BridgeCfg as unknown as { configuration: Configuration }).configuration.setStringArray(
  `${BridgeIdMigrate}_adminRoleIds`,
  ['legacyAdmin']
)

// getOwnerRoleIds should migrate it
assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeIdMigrate), ['legacyAdmin'])
// Should also have saved it to the new key
assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeIdMigrate), ['legacyAdmin'])

// Removal cleans up language key
BridgeCfg.setLanguage(BridgeId, 'ar')
BridgeCfg.addBridgeId(BridgeId)
BridgeCfg.removeBridgeId(BridgeId)
assert.strictEqual(BridgeCfg.getLanguage(BridgeId), undefined)
// And owner/admin roles
assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeId), [])

await DatabaseManagerInstance.flushWrites()
await DatabaseManagerInstance.close()
