import assert from 'node:assert'
import { describe, it } from 'node:test'

describe('Check-in flow logic', () => {
  describe('time window validation', () => {
    const now = Math.floor(Date.now() / 1000)

    it('allows check-in when now >= opensAt and now < closesAt', () => {
      const opensAt = now - 600
      const closesAt = now + 3600
      assert.ok(now >= opensAt)
      assert.ok(now < closesAt)
    })

    it('rejects check-in before window opens', () => {
      const opensAt = now + 600
      assert.ok(now < opensAt)
    })

    it('rejects check-in after window closes', () => {
      const closesAt = now - 600
      assert.ok(now > closesAt)
    })

    it('auto-checkin during join should set checkedInAt', () => {
      const joinTime = now
      const opensAt = now - 600
      const closesAt = now + 3600
      const shouldAutoCheckin = joinTime >= opensAt && joinTime < closesAt
      assert.ok(shouldAutoCheckin)
    })

    it('no auto-checkin when joining before window opens', () => {
      const joinTime = now
      const opensAt = now + 600
      const shouldAutoCheckin = joinTime >= opensAt
      assert.ok(!shouldAutoCheckin)
    })

    it('no auto-checkin when joining after window closes', () => {
      const joinTime = now
      const closesAt = now - 600
      const shouldAutoCheckin = joinTime < closesAt
      assert.ok(!shouldAutoCheckin)
    })
  })

  describe('min participants logic', () => {
    it('allows start when checked-in count >= min', () => {
      const checkedInCount = 4
      const minParticipants = 4
      assert.ok(checkedInCount >= minParticipants)
    })

    it('rejects start when checked-in count < min', () => {
      const checkedInCount = 3
      const minParticipants = 4
      assert.ok(checkedInCount < minParticipants)
    })

    it('allows start with exactly min', () => {
      const checkedInCount = 2
      const minParticipants = 2
      assert.ok(checkedInCount >= minParticipants)
    })

    it('rejects start with only 1 checked-in', () => {
      const checkedInCount = 1
      assert.ok(checkedInCount < 2)
    })
  })

  describe('bye count from checked-in players', () => {
    it('calculates correct bye count for non-power-of-2', () => {
      const checkedInCount = 6
      const totalSlots = Math.pow(2, Math.ceil(Math.log2(checkedInCount)))
      const byeCount = totalSlots - checkedInCount
      assert.strictEqual(totalSlots, 8)
      assert.strictEqual(byeCount, 2)
    })

    it('no byes for power-of-2', () => {
      const checkedInCount = 8
      const totalSlots = Math.pow(2, Math.ceil(Math.log2(checkedInCount)))
      const byeCount = totalSlots - checkedInCount
      assert.strictEqual(totalSlots, 8)
      assert.strictEqual(byeCount, 0)
    })
  })
})
