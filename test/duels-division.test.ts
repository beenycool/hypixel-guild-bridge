import assert from 'node:assert'
import { describe, it } from 'node:test'

import { calculateDuelsDivision } from '../src/instance/commands/common/utility.js'

describe('Duels Division Calculation', () => {
  describe('Individual Gamemodes', () => {
    it('should return Unranked for less than 50 wins', () => {
      assert.equal(calculateDuelsDivision(0, false), 'Unranked')
      assert.equal(calculateDuelsDivision(49, false), 'Unranked')
    })

    it('should calculate Rookie divisions correctly', () => {
      assert.equal(calculateDuelsDivision(50, false), 'Rookie I')
      assert.equal(calculateDuelsDivision(60, false), 'Rookie II')
      assert.equal(calculateDuelsDivision(70, false), 'Rookie III')
      assert.equal(calculateDuelsDivision(80, false), 'Rookie IV')
      assert.equal(calculateDuelsDivision(90, false), 'Rookie V')
    })

    it('should calculate Iron divisions correctly', () => {
      assert.equal(calculateDuelsDivision(100, false), 'Iron I')
      assert.equal(calculateDuelsDivision(130, false), 'Iron II')
      assert.equal(calculateDuelsDivision(220, false), 'Iron V')
    })

    it('should calculate Gold divisions correctly', () => {
      assert.equal(calculateDuelsDivision(250, false), 'Gold I')
      assert.equal(calculateDuelsDivision(450, false), 'Gold V')
    })

    it('should calculate Master divisions correctly', () => {
      assert.equal(calculateDuelsDivision(1000, false), 'Master I')
      assert.equal(calculateDuelsDivision(1910, false), 'Master V')
    })

    it('should calculate Legend divisions correctly', () => {
      assert.equal(calculateDuelsDivision(2000, false), 'Legend I')
      assert.equal(calculateDuelsDivision(3820, false), 'Legend IV')
      assert.equal(calculateDuelsDivision(4400, false), 'Legend V')
    })

    it('should calculate Grandmaster divisions correctly', () => {
      assert.equal(calculateDuelsDivision(5000, false), 'Grandmaster I')
      assert.equal(calculateDuelsDivision(9000, false), 'Grandmaster V')
    })

    it('should calculate Godlike divisions correctly', () => {
      assert.equal(calculateDuelsDivision(10_000, false), 'Godlike I')
      assert.equal(calculateDuelsDivision(13_000, false), 'Godlike II')
      assert.equal(calculateDuelsDivision(22_000, false), 'Godlike V')
    })

    it('should calculate Celestial divisions correctly', () => {
      assert.equal(calculateDuelsDivision(25_000, false), 'Celestial I')
      assert.equal(calculateDuelsDivision(45_000, false), 'Celestial V')
    })

    it('should calculate Divine divisions correctly', () => {
      assert.equal(calculateDuelsDivision(50_000, false), 'Divine I')
      assert.equal(calculateDuelsDivision(90_000, false), 'Divine V')
    })

    it('should calculate Ascended divisions correctly', () => {
      assert.equal(calculateDuelsDivision(100_000, false), 'Ascended I')
      assert.equal(calculateDuelsDivision(110_000, false), 'Ascended II')
      assert.equal(calculateDuelsDivision(590_000, false), 'Ascended L')
    })
  })

  describe('Overall Stats', () => {
    it('should return Unranked for less than 100 wins', () => {
      assert.equal(calculateDuelsDivision(99, true), 'Unranked')
    })

    it('should calculate Rookie divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(100, true), 'Rookie I')
      assert.equal(calculateDuelsDivision(120, true), 'Rookie II')
      assert.equal(calculateDuelsDivision(180, true), 'Rookie V')
    })

    it('should calculate Master divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(2000, true), 'Master I')
      assert.equal(calculateDuelsDivision(3820, true), 'Master V') // 3820/2 = 1910 -> Master V
    })

    it('should calculate Legend divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(4000, true), 'Legend I')
      assert.equal(calculateDuelsDivision(8800, true), 'Legend V')
    })

    it('should calculate Godlike divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(20_000, true), 'Godlike I')
      assert.equal(calculateDuelsDivision(44_000, true), 'Godlike V')
    })

    it('should calculate Ascended divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(200_000, true), 'Ascended I')
    })
  })

  describe('Edge Cases', () => {
    it('should handle boundary values correctly - Mode specific', () => {
      // Just under first division
      assert.equal(calculateDuelsDivision(49, false), 'Unranked')

      // At division starts
      assert.equal(calculateDuelsDivision(50, false), 'Rookie I')
      assert.equal(calculateDuelsDivision(100, false), 'Iron I')
      assert.equal(calculateDuelsDivision(250, false), 'Gold I')
      assert.equal(calculateDuelsDivision(1000, false), 'Master I')

      // Just before next tier
      assert.equal(calculateDuelsDivision(99, false), 'Rookie V') // Last Rookie before Iron
      assert.equal(calculateDuelsDivision(249, false), 'Iron V') // Last Iron before Gold
      assert.equal(calculateDuelsDivision(999, false), 'Diamond V') // Last Diamond before Master
    })

    it('should handle boundary values correctly - Overall', () => {
      // Just under first division
      assert.equal(calculateDuelsDivision(99, true), 'Unranked')

      // At division starts (2x multiplier)
      assert.equal(calculateDuelsDivision(100, true), 'Rookie I')
      assert.equal(calculateDuelsDivision(200, true), 'Iron I')
      assert.equal(calculateDuelsDivision(500, true), 'Gold I')
      assert.equal(calculateDuelsDivision(2000, true), 'Master I')

      // Just before next tier (2x multiplier)
      assert.equal(calculateDuelsDivision(199, true), 'Rookie V') // Last Rookie before Iron
      assert.equal(calculateDuelsDivision(499, true), 'Iron V') // Last Iron before Gold
      assert.equal(calculateDuelsDivision(1999, true), 'Diamond V') // Last Diamond before Master
    })
  })
})
