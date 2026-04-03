import assert from 'node:assert'
import { describe, it } from 'node:test'

import { calculateDuelsDivision } from '../src/instance/commands/common/utility.js'

describe('Duels Division Calculation', () => {
  describe('Short Mode (standard modes)', () => {
    it('should return Unranked for less than 50 wins', () => {
      assert.equal(calculateDuelsDivision(0, 'short'), 'Unranked')
      assert.equal(calculateDuelsDivision(49, 'short'), 'Unranked')
    })

    it('should calculate Rookie divisions correctly', () => {
      assert.equal(calculateDuelsDivision(50, 'short'), 'Rookie I')
      assert.equal(calculateDuelsDivision(60, 'short'), 'Rookie II')
      assert.equal(calculateDuelsDivision(70, 'short'), 'Rookie III')
      assert.equal(calculateDuelsDivision(80, 'short'), 'Rookie IV')
      assert.equal(calculateDuelsDivision(90, 'short'), 'Rookie V')
    })

    it('should calculate Iron divisions correctly', () => {
      assert.equal(calculateDuelsDivision(100, 'short'), 'Iron I')
      assert.equal(calculateDuelsDivision(130, 'short'), 'Iron II')
      assert.equal(calculateDuelsDivision(220, 'short'), 'Iron V')
    })

    it('should calculate Gold divisions correctly', () => {
      assert.equal(calculateDuelsDivision(250, 'short'), 'Gold I')
      assert.equal(calculateDuelsDivision(450, 'short'), 'Gold V')
    })

    it('should calculate Master divisions correctly', () => {
      assert.equal(calculateDuelsDivision(1000, 'short'), 'Master I')
      assert.equal(calculateDuelsDivision(1910, 'short'), 'Master V')
    })

    it('should calculate Legend divisions correctly', () => {
      assert.equal(calculateDuelsDivision(2000, 'short'), 'Legend I')
      assert.equal(calculateDuelsDivision(3820, 'short'), 'Legend IV')
      assert.equal(calculateDuelsDivision(4400, 'short'), 'Legend V')
    })

    it('should calculate Grandmaster divisions correctly', () => {
      assert.equal(calculateDuelsDivision(5000, 'short'), 'Grandmaster I')
      assert.equal(calculateDuelsDivision(9000, 'short'), 'Grandmaster V')
    })

    it('should calculate Godlike divisions correctly', () => {
      assert.equal(calculateDuelsDivision(10_000, 'short'), 'Godlike I')
      assert.equal(calculateDuelsDivision(13_000, 'short'), 'Godlike II')
      assert.equal(calculateDuelsDivision(22_000, 'short'), 'Godlike V')
    })

    it('should calculate Celestial divisions correctly', () => {
      assert.equal(calculateDuelsDivision(25_000, 'short'), 'Celestial I')
      assert.equal(calculateDuelsDivision(45_000, 'short'), 'Celestial V')
    })

    it('should calculate Divine divisions correctly', () => {
      assert.equal(calculateDuelsDivision(50_000, 'short'), 'Divine I')
      assert.equal(calculateDuelsDivision(90_000, 'short'), 'Divine V')
    })

    it('should calculate Ascended divisions correctly', () => {
      assert.equal(calculateDuelsDivision(100_000, 'short'), 'Ascended I')
      assert.equal(calculateDuelsDivision(110_000, 'short'), 'Ascended II')
      assert.equal(calculateDuelsDivision(590_000, 'short'), 'Ascended L')
    })
  })

  describe('Long Mode (Bridge, Boxing, MegaWalls, NoDebuff, Parkour)', () => {
    it('should return Unranked for less than 25 wins', () => {
      assert.equal(calculateDuelsDivision(0, 'long'), 'Unranked')
      assert.equal(calculateDuelsDivision(24, 'long'), 'Unranked')
    })

    it('should calculate Rookie divisions correctly', () => {
      assert.equal(calculateDuelsDivision(25, 'long'), 'Rookie I')
      assert.equal(calculateDuelsDivision(30, 'long'), 'Rookie II')
      assert.equal(calculateDuelsDivision(35, 'long'), 'Rookie III')
      assert.equal(calculateDuelsDivision(40, 'long'), 'Rookie IV')
      assert.equal(calculateDuelsDivision(45, 'long'), 'Rookie V')
    })

    it('should calculate Iron divisions correctly', () => {
      assert.equal(calculateDuelsDivision(50, 'long'), 'Iron I')
      assert.equal(calculateDuelsDivision(65, 'long'), 'Iron II')
      assert.equal(calculateDuelsDivision(110, 'long'), 'Iron V')
    })

    it('should calculate Godlike divisions correctly', () => {
      assert.equal(calculateDuelsDivision(5000, 'long'), 'Godlike I')
      assert.equal(calculateDuelsDivision(6500, 'long'), 'Godlike II')
      assert.equal(calculateDuelsDivision(11_000, 'long'), 'Godlike V')
    })

    it('should calculate Celestial divisions correctly', () => {
      assert.equal(calculateDuelsDivision(12_500, 'long'), 'Celestial I')
      assert.equal(calculateDuelsDivision(22_500, 'long'), 'Celestial V')
    })

    it('should calculate Divine divisions correctly', () => {
      assert.equal(calculateDuelsDivision(25_000, 'long'), 'Divine I')
      assert.equal(calculateDuelsDivision(26_688, 'long'), 'Divine I') // AnIdioticPigeon real case
      assert.equal(calculateDuelsDivision(45_000, 'long'), 'Divine V')
    })

    it('should calculate Ascended divisions correctly', () => {
      assert.equal(calculateDuelsDivision(50_000, 'long'), 'Ascended I')
      assert.equal(calculateDuelsDivision(55_000, 'long'), 'Ascended II')
      assert.equal(calculateDuelsDivision(295_000, 'long'), 'Ascended L')
    })
  })

  describe('Overall Stats', () => {
    it('should return Unranked for less than 100 wins', () => {
      assert.equal(calculateDuelsDivision(99, 'overall'), 'Unranked')
    })

    it('should calculate Rookie divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(100, 'overall'), 'Rookie I')
      assert.equal(calculateDuelsDivision(120, 'overall'), 'Rookie II')
      assert.equal(calculateDuelsDivision(180, 'overall'), 'Rookie V')
    })

    it('should calculate Master divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(2000, 'overall'), 'Master I')
      assert.equal(calculateDuelsDivision(3820, 'overall'), 'Master V')
    })

    it('should calculate Legend divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(4000, 'overall'), 'Legend I')
      assert.equal(calculateDuelsDivision(8800, 'overall'), 'Legend V')
    })

    it('should calculate Godlike divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(20_000, 'overall'), 'Godlike I')
      assert.equal(calculateDuelsDivision(44_000, 'overall'), 'Godlike V')
    })

    it('should calculate Celestial divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(50_000, 'overall'), 'Celestial I')
      assert.equal(calculateDuelsDivision(90_000, 'overall'), 'Celestial V')
    })

    it('should calculate Divine divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(100_000, 'overall'), 'Divine I')
      assert.equal(calculateDuelsDivision(180_000, 'overall'), 'Divine V')
    })

    it('should calculate Ascended divisions correctly (2x multiplier)', () => {
      assert.equal(calculateDuelsDivision(200_000, 'overall'), 'Ascended I')
    })
  })

  describe('Edge Cases', () => {
    it('should handle boundary values correctly - Short mode', () => {
      assert.equal(calculateDuelsDivision(49, 'short'), 'Unranked')
      assert.equal(calculateDuelsDivision(50, 'short'), 'Rookie I')
      assert.equal(calculateDuelsDivision(100, 'short'), 'Iron I')
      assert.equal(calculateDuelsDivision(250, 'short'), 'Gold I')
      assert.equal(calculateDuelsDivision(1000, 'short'), 'Master I')
      assert.equal(calculateDuelsDivision(99, 'short'), 'Rookie V')
      assert.equal(calculateDuelsDivision(249, 'short'), 'Iron V')
      assert.equal(calculateDuelsDivision(999, 'short'), 'Diamond V')
    })

    it('should handle boundary values correctly - Long mode', () => {
      assert.equal(calculateDuelsDivision(24, 'long'), 'Unranked')
      assert.equal(calculateDuelsDivision(25, 'long'), 'Rookie I')
      assert.equal(calculateDuelsDivision(50, 'long'), 'Iron I')
      assert.equal(calculateDuelsDivision(125, 'long'), 'Gold I')
      assert.equal(calculateDuelsDivision(500, 'long'), 'Master I')
      assert.equal(calculateDuelsDivision(49, 'long'), 'Rookie V')
      assert.equal(calculateDuelsDivision(124, 'long'), 'Iron V')
      assert.equal(calculateDuelsDivision(499, 'long'), 'Diamond V')
    })

    it('should handle boundary values correctly - Overall', () => {
      assert.equal(calculateDuelsDivision(99, 'overall'), 'Unranked')
      assert.equal(calculateDuelsDivision(100, 'overall'), 'Rookie I')
      assert.equal(calculateDuelsDivision(200, 'overall'), 'Iron I')
      assert.equal(calculateDuelsDivision(500, 'overall'), 'Gold I')
      assert.equal(calculateDuelsDivision(2000, 'overall'), 'Master I')
      assert.equal(calculateDuelsDivision(199, 'overall'), 'Rookie V')
      assert.equal(calculateDuelsDivision(499, 'overall'), 'Iron V')
      assert.equal(calculateDuelsDivision(1999, 'overall'), 'Diamond V')
    })
  })
})
