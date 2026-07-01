import { createHmac, timingSafeEqual } from 'node:crypto'

export interface TokenPayload {
  sub: string
  perm: number
  exp: number
  iat: number
}

export function signToken(payload: TokenPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifySignedToken(token: string, secret: string): TokenPayload | null {
  const dot = token.indexOf('.')
  if (dot === -1) return null

  const data = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!data || !sig) return null

  const expected = createHmac('sha256', secret).update(data).digest('base64url')
  if (sig.length !== expected.length) return null

  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }

  try {
    const raw = Buffer.from(data, 'base64url').toString()
    const payload: TokenPayload = JSON.parse(raw)
    if (typeof payload.sub !== 'string' || typeof payload.perm !== 'number' || typeof payload.exp !== 'number') {
      return null
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
