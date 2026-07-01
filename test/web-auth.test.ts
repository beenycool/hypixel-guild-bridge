import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Permission } from '../src/common/application-event.js'
import { verifyToken } from '../src/instance/web/auth.js'
import { signToken } from '../src/instance/web/signed-token.js'

await describe('verifyToken', async () => {
  await it('returns Admin permission with matching Bearer admin token', () => {
    assert.deepStrictEqual(
      verifyToken({ admin: 'admin-secret', owner: 'owner-secret', helper: 'helper-secret' }, 'Bearer admin-secret'),
      {
        ok: true,
        permission: Permission.Admin
      }
    )
  })

  await it('returns Owner permission with matching Bearer owner token', () => {
    assert.deepStrictEqual(
      verifyToken({ admin: 'admin-secret', owner: 'owner-secret', helper: 'helper-secret' }, 'Bearer owner-secret'),
      {
        ok: true,
        permission: Permission.Owner
      }
    )
  })

  await it('returns Helper permission with matching Bearer helper token', () => {
    assert.deepStrictEqual(
      verifyToken({ admin: 'admin-secret', owner: 'owner-secret', helper: 'helper-secret' }, 'Bearer helper-secret'),
      {
        ok: true,
        permission: Permission.Helper
      }
    )
  })

  await it('returns mismatch when Bearer token is wrong', () => {
    assert.deepStrictEqual(
      verifyToken({ admin: 'admin-secret', owner: 'owner-secret', helper: 'helper-secret' }, 'Bearer wrong'),
      {
        ok: false,
        reason: 'mismatch'
      }
    )
  })

  await it('returns missing when no header and no query token', () => {
    assert.deepStrictEqual(verifyToken({ admin: 'admin-secret' }, undefined), { ok: false, reason: 'missing' })
  })

  await it('returns mismatch when Bearer token has different length', () => {
    assert.deepStrictEqual(verifyToken({ admin: 'secret' }, 'Bearer longerversion'), {
      ok: false,
      reason: 'mismatch'
    })
  })

  await it('returns Admin permission with matching query token (single token, uses admin)', () => {
    assert.deepStrictEqual(verifyToken({ admin: 'secret' }, undefined, 'secret'), {
      ok: true,
      permission: Permission.Admin
    })
  })

  await it('returns mismatch with wrong query token', () => {
    assert.deepStrictEqual(verifyToken({ admin: 'secret' }, undefined, 'wrong'), { ok: false, reason: 'mismatch' })
  })

  await it('returns missing when query token is an empty array', () => {
    const result = verifyToken({ admin: 'secret' }, undefined, [])
    assert.strictEqual(result.ok, false)
  })

  await it('returns Admin permission when query token is an array with matching first element', () => {
    assert.deepStrictEqual(verifyToken({ admin: 'secret' }, undefined, ['secret', 'extra']), {
      ok: true,
      permission: Permission.Admin
    })
  })

  await it('returns missing when server token is empty', () => {
    assert.deepStrictEqual(verifyToken({ admin: '' }, 'Bearer anything'), { ok: false, reason: 'missing' })
  })

  await it('falls through: admin does not match -> try owner -> owner matches -> returns Owner', () => {
    assert.deepStrictEqual(
      verifyToken({ admin: 'admin-secret', owner: 'owner-secret', helper: 'helper-secret' }, 'Bearer owner-secret'),
      {
        ok: true,
        permission: Permission.Owner
      }
    )
  })

  await it('falls through: admin does not match -> owner does not match -> helper matches -> returns Helper', () => {
    assert.deepStrictEqual(
      verifyToken({ admin: 'admin-secret', owner: 'owner-secret', helper: 'helper-secret' }, 'Bearer helper-secret'),
      {
        ok: true,
        permission: Permission.Helper
      }
    )
  })

  await it('does not consult query token when header is wrong but present', () => {
    assert.deepStrictEqual(verifyToken({ admin: 'secret' }, 'Bearer wrong', 'secret'), {
      ok: false,
      reason: 'mismatch'
    })
  })

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
    const result = verifyToken({ admin: 'static-admin', signingSecret: secret }, `Bearer ${signed}`)
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
    const result = verifyToken({ admin: 'static-admin', signingSecret: secret }, `Bearer ${signed}`)
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
    const result = verifyToken({ admin: 'static-admin', signingSecret: secret }, `Bearer ${signed}`)
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
    const result = verifyToken({ admin: 'static-admin', signingSecret: secret }, `Bearer ${signed}`)
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
    const result = verifyToken({ admin: 'static-admin', signingSecret: 'wrong-secret' }, `Bearer ${signed}`)
    assert.strictEqual(result.ok, false)
  })

  await it('falls back to static token when no signingSecret configured', () => {
    const result = verifyToken({ admin: 'static-secret' }, 'Bearer static-secret')
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.strictEqual(result.permission, Permission.Admin)
      assert.strictEqual(result.userId, undefined)
    }
  })
})
