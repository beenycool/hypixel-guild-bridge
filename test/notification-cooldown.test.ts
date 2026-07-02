import assert from 'node:assert'
import { describe, it } from 'node:test'

import { isNotificationDue } from '../src/core/rankup/notification-cooldown.js'

await describe('isNotificationDue', async () => {
  await it('returns true when notifiedAt is undefined', () => {
    assert.strictEqual(isNotificationDue(undefined, 60 * 60 * 1000, 5000), true)
  })

  await it('returns false when within cooldown', () => {
    const now = 100_000_000_000
    const notifiedAt = 100_000_000_000 // same second as now
    assert.strictEqual(isNotificationDue(notifiedAt, 60 * 60 * 1000, now), false)
  })

  await it('returns false exactly at cooldown boundary', () => {
    const now = 100_003_600_000 // 1 hour later in ms
    const notifiedAt = 100_000_000_000 // 1 hour earlier in seconds
    assert.strictEqual(isNotificationDue(notifiedAt, 60 * 60 * 1000, now), false)
  })

  await it('returns true when past cooldown', () => {
    const notifiedAt = 1_000_000_000 // 2001-09-09 in seconds
    const cooldownMs = 7_200_000 // 2 hours
    const nowMs = notifiedAt * 1000 + cooldownMs + 1 // 1ms past cooldown
    assert.strictEqual(isNotificationDue(notifiedAt, cooldownMs, nowMs), true)
  })
})
