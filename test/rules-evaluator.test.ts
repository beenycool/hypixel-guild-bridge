import assert from 'node:assert'
import { describe, it } from 'node:test'

import { RulesEvaluator } from '../src/core/rankup/rules-evaluator.js'

await describe('RulesEvaluator', async () => {
  await it('ignores invalid demotion rules that have no target rank', () => {
    const evaluator = new RulesEvaluator()
    const result = evaluator.evaluate(
      {
        uuid: 'uuid-1',
        rank: 'Officer',
        joinedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
        weeklyGexp: 0,
        lastOnline: 0
      },
      [],
      [
        {
          fromRank: 'Officer',
          action: 'demote',
          maxWeeklyGexp: 10,
          gracePeriod: 0
        }
      ],
      [],
      [],
      ['member', 'officer']
    )

    assert.deepStrictEqual(result, { action: 'none' })
  })
})
