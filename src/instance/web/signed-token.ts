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

export function verifySignedToken(token: string, secret: string): TokenPayload | undefined {
  const dot = token.indexOf('.')
  if (dot === -1) return undefined

  const data = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!data || !sig) return undefined

  const expected = createHmac('sha256', secret).update(data).digest('base64url')
  if (sig.length !== expected.length) return undefined

  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined
  } catch {
    return undefined
  }

  try {
    const raw = Buffer.from(data, 'base64url').toString()
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || !parsed) return undefined
    const payload = parsed as Partial<TokenPayload>
    if (typeof payload.sub !== 'string' || typeof payload.perm !== 'number' || typeof payload.exp !== 'number') {
      return undefined
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return undefined
    return payload as TokenPayload
  } catch {
    return undefined
  }
}
