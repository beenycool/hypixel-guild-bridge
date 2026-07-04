import assert from 'node:assert'
import { describe, it } from 'node:test'

import { validateSeriesScore } from '../src/core/tournament/score-validator.js'

function getForfeitWinner(forfeitingId: number, p1Id: number, p2Id: number): number {
  return forfeitingId === p1Id ? p2Id : p1Id
}

describe('MatchManager score & forfeit validation (pure logic)', () => {
  describe('score validation (via validateSeriesScore)', () => {
    it('correctly validates Best-of-3 scores', () => {
      assert.ok(validateSeriesScore(3, 2, 0).valid)
      assert.ok(validateSeriesScore(3, 2, 1).valid)
      assert.ok(validateSeriesScore(3, 0, 2).valid)
      assert.ok(validateSeriesScore(3, 1, 2).valid)
      assert.ok(!validateSeriesScore(3, 2, 2).valid, 'tie should be invalid')
      assert.ok(!validateSeriesScore(3, 1, 1).valid, 'not finished should be invalid')
    })

    it('correctly validates Best-of-5 scores', () => {
      assert.ok(validateSeriesScore(5, 3, 0).valid)
      assert.ok(validateSeriesScore(5, 3, 2).valid)
      assert.ok(validateSeriesScore(5, 0, 3).valid)
      assert.ok(validateSeriesScore(5, 2, 3).valid)
      assert.ok(!validateSeriesScore(5, 3, 3).valid, 'tie should be invalid')
      assert.ok(!validateSeriesScore(5, 2, 2).valid, 'not finished should be invalid')
    })

    it('rejects impossible totals', () => {
      assert.ok(!validateSeriesScore(3, 3, 0).valid, 'cannot exceed bestOf')
      assert.ok(!validateSeriesScore(5, 5, 0).valid, 'cannot exceed bestOf')
    })

    it('rejects negative scores', () => {
      assert.ok(!validateSeriesScore(3, -1, 2).valid)
      assert.ok(!validateSeriesScore(3, 2, -1).valid)
    })
  })

  describe('forfeit logic validation', () => {
    it('p1 forfeits → p2 wins', () => {
      const p1 = 100
      const p2 = 200
      assert.strictEqual(getForfeitWinner(p1, p1, p2), p2)
    })

    it('p2 forfeits → p1 wins', () => {
      const p1 = 100
      const p2 = 200
      assert.strictEqual(getForfeitWinner(p2, p1, p2), p1)
    })

    it('self-forfeit not possible (always gets opponent)', () => {
      const p1 = 100
      const p2 = 200
      assert.notStrictEqual(getForfeitWinner(p1, p1, p2), p1)
    })
  })
})
