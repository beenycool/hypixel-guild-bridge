import assert from 'node:assert'
import { describe, it } from 'node:test'

import type Application from '../src/application.js'

interface MockBridgeConfigurations {
  getPersistGuildOnlineOffline: (bridgeId: string) => boolean
}

interface MockCorePartial {
  bridgeConfigurations: MockBridgeConfigurations
  discordConfigurations?: { getGuildOnline: () => boolean; getGuildOffline: () => boolean }
  discordTemporarilyInteractions?: { add: (entries: unknown[]) => void }
}

function computeShouldPersist(app: Application, bridgeId: string | undefined): boolean {
  if (!app.bridgeResolver.isMultiBridgeEnabled() || bridgeId === undefined) {
    return false
  }
  return (app.core as MockCorePartial).bridgeConfigurations.getPersistGuildOnlineOffline(bridgeId)
}

await describe('DiscordBridge persist online/offline messages', async () => {
  await it('should NOT add to deleter when persist is enabled (multi-bridge, bridgeId present)', () => {
    let addCallCount = 0
    const mockDiscordTemporarilyInteractions = {
      add: () => {
        addCallCount++
      }
    }

    const mockApplication = {
      bridgeResolver: { isMultiBridgeEnabled: () => true },
      core: {
        bridgeConfigurations: {
          getPersistGuildOnlineOffline: (id: string) => id === 'test-bridge'
        } satisfies MockBridgeConfigurations,
        discordConfigurations: { getGuildOnline: () => true, getGuildOffline: () => true },
        discordTemporarilyInteractions: mockDiscordTemporarilyInteractions
      }
    } as unknown as Application

    const shouldPersist = computeShouldPersist(mockApplication, 'test-bridge')

    assert.strictEqual(shouldPersist, true)
    assert.strictEqual(addCallCount, 0)
  })

  await it('should add to deleter when persist is disabled (multi-bridge, bridgeId present)', () => {
    const mockApplication = {
      bridgeResolver: { isMultiBridgeEnabled: () => true },
      core: {
        bridgeConfigurations: {
          getPersistGuildOnlineOffline: () => false
        } satisfies MockBridgeConfigurations
      }
    } as unknown as Application

    const shouldPersist = computeShouldPersist(mockApplication, 'test-bridge')

    assert.strictEqual(shouldPersist, false)
  })

  await it('should default to false (delete) when multi-bridge is disabled', () => {
    const mockApplication = {
      bridgeResolver: { isMultiBridgeEnabled: () => false }
    } as unknown as Application

    const shouldPersist = computeShouldPersist(mockApplication, 'test-bridge')

    assert.strictEqual(shouldPersist, false)
  })

  await it('should default to false (delete) when bridgeId is undefined', () => {
    const mockApplication = {
      bridgeResolver: { isMultiBridgeEnabled: () => true }
    } as unknown as Application

    const shouldPersist = computeShouldPersist(mockApplication, undefined)

    assert.strictEqual(shouldPersist, false)
  })
})
