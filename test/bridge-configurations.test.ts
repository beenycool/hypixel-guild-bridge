import assert from 'node:assert'

import type Application from '../src/application.js'
import { DatabaseManager } from '../src/common/database-manager'
import { ConfigurationsManager } from '../src/core/configurations'
import type { Configuration } from '../src/core/configurations'
import { BridgeConfigurations } from '../src/core/discord/bridge-configurations'
import { initializeCoreDatabase } from '../src/core/initialize-database'

const Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
} as unknown as ConstructorParameters<typeof DatabaseManager>[1]

const FakeApp: {
  applicationIntegrity: { addConfigPath: () => void }
  addShutdownListener: () => void
  getDatabaseConfig: () => { url: string }
  getConfigFilePath: (name: string) => string
} = {
  applicationIntegrity: {
    addConfigPath: () => {}
  },
  addShutdownListener: () => {},
  getDatabaseConfig: () => ({ url: 'memory://bridge-config-test' }),
  getConfigFilePath: (name: string) => `/tmp/nonexistent-${name}`
}

const DatabaseManagerInstance = new DatabaseManager(FakeApp as unknown as Application, Logger)

await initializeCoreDatabase(DatabaseManagerInstance)

const Configs = new ConfigurationsManager(DatabaseManagerInstance)
const BridgeCfg = new BridgeConfigurations(Configs)
await Configs.load()

const BridgeId = 'bridge-test'

assert.strictEqual(BridgeCfg.getPersistGuildOnlineOffline(BridgeId), false)
BridgeCfg.setPersistGuildOnlineOffline(BridgeId, true)
assert.strictEqual(BridgeCfg.getPersistGuildOnlineOffline(BridgeId), true)
BridgeCfg.setPersistGuildOnlineOffline(BridgeId, false)
assert.strictEqual(BridgeCfg.getPersistGuildOnlineOffline(BridgeId), false)

BridgeCfg.setPersistGuildOnlineOffline(BridgeId, true)
BridgeCfg.addBridgeId(BridgeId)
BridgeCfg.removeBridgeId(BridgeId)
assert.strictEqual(BridgeCfg.getPersistGuildOnlineOffline(BridgeId), false)

assert.strictEqual(BridgeCfg.getLanguage(BridgeId), undefined)
BridgeCfg.setLanguage(BridgeId, 'de')
assert.strictEqual(BridgeCfg.getLanguage(BridgeId), 'de')
BridgeCfg.setLanguage(BridgeId, undefined)
assert.strictEqual(BridgeCfg.getLanguage(BridgeId), undefined)

assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeId), [])
BridgeCfg.setOwnerRoleIds(BridgeId, ['owner1'])
assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeId), ['owner1'])

const BridgeIdMigrate = 'bridge-migrate'

;(BridgeCfg as unknown as { configuration: Configuration }).configuration.setStringArray(
  `${BridgeIdMigrate}_adminRoleIds`,
  ['legacyAdmin']
)

assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeIdMigrate), ['legacyAdmin'])

assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeIdMigrate), ['legacyAdmin'])

BridgeCfg.setLanguage(BridgeId, 'ar')
BridgeCfg.addBridgeId(BridgeId)
BridgeCfg.removeBridgeId(BridgeId)
assert.strictEqual(BridgeCfg.getLanguage(BridgeId), undefined)

assert.deepStrictEqual(BridgeCfg.getOwnerRoleIds(BridgeId), [])

assert.strictEqual(BridgeCfg.getPlayerUsernameOverride(BridgeId, 'Steve'), undefined)
BridgeCfg.setPlayerUsernameOverride(BridgeId, 'Steve', 'NotSteve')
assert.strictEqual(BridgeCfg.getPlayerUsernameOverride(BridgeId, 'Steve'), 'NotSteve')

assert.strictEqual(BridgeCfg.getPlayerUsernameOverride(BridgeId, 'steve'), 'NotSteve')

assert.strictEqual(BridgeCfg.getPlayerUsernameOverride(BridgeId, 'Alex'), undefined)

BridgeCfg.setPlayerUsernameOverride(BridgeId, 'Steve', 'CoolName')
assert.strictEqual(BridgeCfg.getPlayerUsernameOverride(BridgeId, 'Steve'), 'CoolName')

BridgeCfg.setPlayerUsernameOverride(BridgeId, 'Steve', undefined)
assert.strictEqual(BridgeCfg.getPlayerUsernameOverride(BridgeId, 'Steve'), undefined)

BridgeCfg.setPlayerUsernameOverride(BridgeId, 'Steve', 'NotSteve')
BridgeCfg.setPlayerUsernameOverride(BridgeId, 'Alex', 'Alex2')
assert.deepStrictEqual(BridgeCfg.getPlayerUsernameOverrides(BridgeId), { steve: 'NotSteve', alex: 'Alex2' })

BridgeCfg.addBridgeId(BridgeId)
BridgeCfg.removeBridgeId(BridgeId)
assert.strictEqual(BridgeCfg.getPlayerUsernameOverride(BridgeId, 'Steve'), undefined)
assert.strictEqual(BridgeCfg.getPlayerUsernameOverride(BridgeId, 'Alex'), undefined)
assert.deepStrictEqual(BridgeCfg.getPlayerUsernameOverrides(BridgeId), {})

await DatabaseManagerInstance.flushWrites()
await DatabaseManagerInstance.close()
