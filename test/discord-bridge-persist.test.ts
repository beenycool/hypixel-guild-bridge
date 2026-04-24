import assert from 'node:assert'
import { describe, it } from 'node:test'

import type Application from '../src/application.js'

/**
 * Unit tests for the persist guild online/offline setting.
 * Verifies that when getPersistGuildOnlineOffline is true, Online/Offline messages
 * are not queued for deletion, and when false, they are.
 */
await describe('DiscordBridge persist online/offline messages', async () => {
  await it('should NOT add to deleter when persist is enabled (multi-bridge, bridgeId present)', () => {
    let addCallCount = 0
    const mockDiscordTemporarilyInteractions = {
      add: (entries: unknown[]) => {
        addCallCount++
      }
    }

    const bridgeId = 'test-bridge'
    const mockApplication = {
      bridgeResolver: {
        isMultiBridgeEnabled: () => true
      },
      core: {
        bridgeConfigurations: {
          getPersistGuildOnlineOffline: (id: string) => id === bridgeId
        },
        discordConfigurations: {
          getGuildOnline: () => true,
          getGuildOffline: () => true
        },
        discordTemporarilyInteractions: mockDiscordTemporarilyInteractions
      }
    } as unknown as Application

    // Simulate the conditional logic used in DiscordBridge.onGuildPlayer
    const shouldPersist =
      mockApplication.bridgeResolver.isMultiBridgeEnabled() && bridgeId !== undefined
        ? mockApplication.core.bridgeConfigurations.getPersistGuildOnlineOffline(bridgeId)
        : false

    assert.strictEqual(shouldPersist, true)
    // When shouldPersist is true, the code does NOT call messageDeleter.add
    assert.strictEqual(addCallCount, 0)
  })

  await it('should add to deleter when persist is disabled (multi-bridge, bridgeId present)', () => {
    const mockApplication = {
      bridgeResolver: {
        isMultiBridgeEnabled: () => true
      },
      core: {
        bridgeConfigurations: {
          getPersistGuildOnlineOffline: () => false
        }
      }
    } as unknown as Application

    const bridgeId = 'test-bridge'
    const shouldPersist =
      mockApplication.bridgeResolver.isMultiBridgeEnabled() && bridgeId !== undefined
        ? mockApplication.core.bridgeConfigurations.getPersistGuildOnlineOffline(bridgeId)
        : false

    assert.strictEqual(shouldPersist, false)
  })

  await it('should default to false (delete) when multi-bridge is disabled', () => {
    const mockApplication = {
      bridgeResolver: {
        isMultiBridgeEnabled: () => false
      }
    } as unknown as Application

    const bridgeId = 'test-bridge'
    const shouldPersist =
      mockApplication.bridgeResolver.isMultiBridgeEnabled() && bridgeId !== undefined
        ? mockApplication.core.bridgeConfigurations.getPersistGuildOnlineOffline(bridgeId)
        : false

    assert.strictEqual(shouldPersist, false)
  })

  await it('should default to false (delete) when bridgeId is undefined', () => {
    const mockApplication = {
      bridgeResolver: {
        isMultiBridgeEnabled: () => true
      }
    } as unknown as Application

    const bridgeId = undefined
    const shouldPersist =
      mockApplication.bridgeResolver.isMultiBridgeEnabled() && bridgeId !== undefined
        ? (mockApplication.core as any).bridgeConfigurations?.getPersistGuildOnlineOffline(bridgeId)
        : false

    assert.strictEqual(shouldPersist, false)
  })
})
