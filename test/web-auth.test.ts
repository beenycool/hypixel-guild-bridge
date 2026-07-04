import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Permission } from '../src/common/application-event.js'
import { verifyToken } from '../src/instance/web/auth.js'
import { signToken } from '../src/instance/web/signed-token.js'

await describe('verifyToken', async () => {
  await it('returns Admin permission from valid signed token', () => {
    const secret = 'my-signing-secret'
    const signed = signToken(
      {
        sub: 'user123',
        perm: Permission.Admin,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      },
      secret
    )
    const result = verifyToken({ signingSecret: secret }, `Bearer ${signed}`)
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.strictEqual(result.permission, Permission.Admin)
      assert.strictEqual(result.userId, 'user123')
    }
  })

  await it('returns Owner permission from valid signed token', () => {
    const secret = 'my-signing-secret'
    const signed = signToken(
      {
        sub: 'user456',
        perm: Permission.Owner,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      },
      secret
    )
    const result = verifyToken({ signingSecret: secret }, `Bearer ${signed}`)
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.strictEqual(result.permission, Permission.Owner)
      assert.strictEqual(result.userId, 'user456')
    }
  })

  await it('returns Helper permission from valid signed token', () => {
    const secret = 'my-signing-secret'
    const signed = signToken(
      {
        sub: 'user789',
        perm: Permission.Helper,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      },
      secret
    )
    const result = verifyToken({ signingSecret: secret }, `Bearer ${signed}`)
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.strictEqual(result.permission, Permission.Helper)
      assert.strictEqual(result.userId, 'user789')
    }
  })

  await it('rejects expired signed token', () => {
    const secret = 'my-signing-secret'
    const signed = signToken(
      {
        sub: 'user123',
        perm: Permission.Helper,
        exp: Math.floor(Date.now() / 1000) - 1,
        iat: Math.floor(Date.now() / 1000) - 7200
      },
      secret
    )
    const result = verifyToken({ signingSecret: secret }, `Bearer ${signed}`)
    assert.strictEqual(result.ok, false)
  })

  await it('rejects signed token with wrong secret', () => {
    const signed = signToken(
      {
        sub: 'user123',
        perm: Permission.Admin,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      },
      'real-secret'
    )
    const result = verifyToken({ signingSecret: 'wrong-secret' }, `Bearer ${signed}`)
    assert.strictEqual(result.ok, false)
  })

  await it('returns missing when no signingSecret configured', () => {
    const result = verifyToken({ signingSecret: '' }, undefined)
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.reason, 'missing')
    }
  })

  await it('returns missing when no header and no query token', () => {
    const result = verifyToken({ signingSecret: 'secret' }, undefined)
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.reason, 'missing')
    }
  })
})
