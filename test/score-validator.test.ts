import assert from 'node:assert'
import { describe, it } from 'node:test'

import { validateSeriesScore } from '../src/core/tournament/score-validator.js'

describe('validateSeriesScore', () => {
  describe('Best of 3', () => {
    it('accepts 2-0 (p1 wins)', () => {
      const r = validateSeriesScore(3, 2, 0)
      assert.ok(r.valid)
    })

    it('accepts 0-2 (p2 wins)', () => {
      const r = validateSeriesScore(3, 0, 2)
      assert.ok(r.valid)
    })

    it('accepts 2-1', () => {
      const r = validateSeriesScore(3, 2, 1)
      assert.ok(r.valid)
    })

    it('rejects 2-2 (tie, impossible total)', () => {
      const r = validateSeriesScore(3, 2, 2)
      assert.ok(!r.valid)
      assert.ok(r.message.includes('tie') || r.message.includes('exceed'))
    })

    it('rejects 1-1 (not finished)', () => {
      const r = validateSeriesScore(3, 1, 1)
      assert.ok(!r.valid)
      assert.ok(r.message.includes('not finished'))
    })

    it('rejects 0-0 (empty)', () => {
      const r = validateSeriesScore(3, 0, 0)
      assert.ok(!r.valid)
      assert.ok(r.message.includes('not finished'))
    })

    it('rejects negative scores', () => {
      const r = validateSeriesScore(3, -1, 2)
      assert.ok(!r.valid)
      assert.ok(r.message.includes('non-negative'))
    })
  })

  describe('Best of 5', () => {
    it('accepts 3-0', () => {
      assert.ok(validateSeriesScore(5, 3, 0).valid)
    })

    it('accepts 3-2', () => {
      assert.ok(validateSeriesScore(5, 3, 2).valid)
    })

    it('rejects 3-3 (tie)', () => {
      assert.ok(!validateSeriesScore(5, 3, 3).valid)
    })

    it('rejects 2-2 (not finished)', () => {
      assert.ok(!validateSeriesScore(5, 2, 2).valid)
    })

    it('rejects 4-1 (too many wins)', () => {
      assert.ok(!validateSeriesScore(5, 4, 1).valid)
    })
  })

  describe('Edge cases', () => {
    it('rejects non-integer bestOf', () => {
      assert.ok(!validateSeriesScore(0, 1, 0).valid)
    })

    it('rejects non-integer scores', () => {
      const r = validateSeriesScore(3, 1.5, 0.5)
      assert.ok(!r.valid)
    })

    it('accepts best-of-1 (1-0)', () => {
      assert.ok(validateSeriesScore(1, 1, 0).valid)
    })

    it('rejects best-of-1 tie (1-1 impossible)', () => {
      const r = validateSeriesScore(1, 1, 1)
      assert.ok(!r.valid)
    })

    it('accepts best-of-7 (4-3)', () => {
      assert.ok(validateSeriesScore(7, 4, 3).valid)
    })

    it('accepts best-of-7 (4-0)', () => {
      assert.ok(validateSeriesScore(7, 4, 0).valid)
    })

    it('rejects best-of-7 (5-0, impossible)', () => {
      assert.ok(!validateSeriesScore(7, 5, 0).valid)
    })
  })
})
