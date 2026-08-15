import assert from 'node:assert'
import { describe, it } from 'node:test'

import { formatBridgeWins, getBridgeStatsFromRawDuels } from '../src/instance/commands/triggers/duels.js'

await describe('Bridge Duels raw stats', async () => {
  await it('sums all raw bridge win fields', () => {
    /* eslint-disable @typescript-eslint/naming-convention */
    const rawDuels = {
      bridge_duel_wins: 14_587,
      bridge_doubles_wins: 9467,
      bridge_threes_wins: 2407,
      bridge_four_wins: 625,
      bridge_2v2v2v2_wins: 8,
      bridge_3v3v3v3_wins: 139,
      capture_threes_wins: 21,
      current_bridge_winstreak: 83,
      best_bridge_winstreak: 405,
      bridge_duel_losses: 913,
      bridge_doubles_losses: 554,
      bridge_threes_losses: 126,
      bridge_four_losses: 116,
      bridge_2v2v2v2_losses: 28,
      bridge_3v3v3v3_losses: 150,
      capture_threes_losses: 8
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    const stats = getBridgeStatsFromRawDuels(rawDuels)

    assert.strictEqual(stats.wins, 27_254)
    assert.strictEqual(stats.winstreak, 83)
    assert.strictEqual(stats.bestWinstreak, 405)
    assert.strictEqual(stats.WLRatio, 14.38)
    assert.strictEqual(formatBridgeWins(stats.wins), '27.2k')
  })
})
