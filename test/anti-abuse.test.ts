import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AntiAbuse } from '../src/core/tournament/anti-abuse.js'

const mockDatabase = {}

await describe('AntiAbuse', async () => {
  await it('should allow the first signup attempt and reject an immediate repeat from the same user', () => {
    const antiAbuse = new AntiAbuse(mockDatabase as never)

    assert.equal(antiAbuse.checkSignupRate('user-1').allowed, true)
    const second = antiAbuse.checkSignupRate('user-1')
    assert.equal(second.allowed, false)
    assert.match(second.reason ?? '', /slow down/i)
  })

  await it('should not rate-limit different users', () => {
    const antiAbuse = new AntiAbuse(mockDatabase as never)

    assert.equal(antiAbuse.checkSignupRate('user-1').allowed, true)
    assert.equal(antiAbuse.checkSignupRate('user-2').allowed, true)
    assert.equal(antiAbuse.checkSignupRate('user-3').allowed, true)
  })
})
