import assert from 'node:assert'
import { describe, it } from 'node:test'

import GuildExperience from '../src/instance/commands/triggers/guildexp.js'

await describe('GuildExperience Promotion & Next Rank Checks', async () => {
  // formatResponse is private; expose it through a minimal typed view instead of `any`.
  const command = new GuildExperience() as unknown as {
    formatResponse(...callArguments: unknown[]): string
  }

  await it('formats standard weekly GEXP when no context or bridge is provided', () => {
    const member = { uuid: 'uuid-1', rank: 'Member', joinedAt: Date.now(), weeklyExperience: 50_000 }
    const result = command.formatResponse('Steve', 'weekly', member)
    assert.strictEqual(result, "Steve's Weekly Guild Experience: 50,000.")
  })

  await it('formats promotion eligibility when member qualifies for next rank', () => {
    const member = {
      uuid: 'uuid-1',
      rank: 'Member',
      joinedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      weeklyExperience: 100_000
    }
    const guild = {
      ranks: [
        { name: 'Member', priority: 1 },
        { name: 'Officer', priority: 2 }
      ]
    }
    const mockContext = {
      message: { instanceName: 'mc-1' },
      app: {
        bridgeResolver: {
          getBridgeIdForInstance: () => 'bridge-1'
        },
        core: {
          bridgeConfigurations: {
            getRankupRules: () => [
              { targetRank: 'Officer', minWeeklyGexp: 80_000, minDaysInGuild: 7, minOnlineHours: 0 }
            ],
            getRankupDemotionRules: () => [],
            getRankupExcludedRanks: () => [],
            getRankupExcludedPlayers: () => [],
            getRankupEnabled: () => true,
            getRankupManualReview: () => false
          },
          rankupManager: {
            runTaskForBridge: () => Promise.resolve()
          }
        }
      },
      logger: {
        error: () => {
          /* noop */
        }
      }
    }

    const result = command.formatResponse('Steve', 'weekly', member, mockContext, guild)
    assert.strictEqual(
      result,
      "Steve's Weekly Guild Experience: 100,000. Eligible for promotion to Officer! (Auto-promoting...)"
    )
  })

  await it('formats next rank progress when member has insufficient GEXP', () => {
    const member = {
      uuid: 'uuid-1',
      rank: 'Member',
      joinedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      weeklyExperience: 45_000
    }
    const guild = {
      ranks: [
        { name: 'Member', priority: 1 },
        { name: 'Officer', priority: 2 }
      ]
    }
    const mockContext = {
      message: { instanceName: 'mc-1' },
      app: {
        bridgeResolver: {
          getBridgeIdForInstance: () => 'bridge-1'
        },
        core: {
          bridgeConfigurations: {
            getRankupRules: () => [
              { targetRank: 'Officer', minWeeklyGexp: 80_000, minDaysInGuild: 7, minOnlineHours: 0 }
            ],
            getRankupDemotionRules: () => [],
            getRankupExcludedRanks: () => [],
            getRankupExcludedPlayers: () => [],
            getRankupEnabled: () => true,
            getRankupManualReview: () => false
          }
        }
      }
    }

    const result = command.formatResponse('Steve', 'weekly', member, mockContext, guild)
    assert.strictEqual(
      result,
      "Steve's Weekly Guild Experience: 45,000. Next rank [Officer]: 45,000 / 80,000 GEXP (35,000 needed)."
    )
  })

  await it('formats next rank progress when member needs days in guild', () => {
    const member = {
      uuid: 'uuid-1',
      rank: 'Member',
      joinedAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days in guild
      weeklyExperience: 90_000
    }
    const guild = {
      ranks: [
        { name: 'Member', priority: 1 },
        { name: 'Officer', priority: 2 }
      ]
    }
    const mockContext = {
      message: { instanceName: 'mc-1' },
      app: {
        bridgeResolver: {
          getBridgeIdForInstance: () => 'bridge-1'
        },
        core: {
          bridgeConfigurations: {
            getRankupRules: () => [
              { targetRank: 'Officer', minWeeklyGexp: 80_000, minDaysInGuild: 7, minOnlineHours: 0 }
            ],
            getRankupDemotionRules: () => [],
            getRankupExcludedRanks: () => [],
            getRankupExcludedPlayers: () => [],
            getRankupEnabled: () => true,
            getRankupManualReview: () => false
          }
        }
      }
    }

    const result = command.formatResponse('Steve', 'weekly', member, mockContext, guild)
    assert.strictEqual(
      result,
      "Steve's Weekly Guild Experience: 90,000. Next rank [Officer]: 90,000 / 80,000 GEXP & 3/7 days in guild."
    )
  })

  await it('formats next rank progress when command originates from Discord (instance lookup fails, bridgeId on event)', () => {
    const member = {
      uuid: 'uuid-1',
      rank: 'Member',
      joinedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      weeklyExperience: 45_000
    }
    const guild = {
      ranks: [
        { name: 'Member', priority: 1 },
        { name: 'Officer', priority: 2 }
      ]
    }
    const mockContext = {
      message: { instanceName: 'discord', bridgeId: 'bridge-1' },
      app: {
        bridgeResolver: {
          getBridgeIdForInstance: () => undefined
        },
        core: {
          bridgeConfigurations: {
            getRankupRules: () => [
              { targetRank: 'Officer', minWeeklyGexp: 80_000, minDaysInGuild: 7, minOnlineHours: 0 }
            ],
            getRankupDemotionRules: () => [],
            getRankupExcludedRanks: () => [],
            getRankupExcludedPlayers: () => [],
            getRankupEnabled: () => true,
            getRankupManualReview: () => false
          }
        }
      }
    }

    const result = command.formatResponse('Steve', 'weekly', member, mockContext, guild)
    assert.strictEqual(
      result,
      "Steve's Weekly Guild Experience: 45,000. Next rank [Officer]: 45,000 / 80,000 GEXP (35,000 needed)."
    )
  })
})
