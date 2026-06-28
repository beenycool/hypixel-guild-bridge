import { timingSafeEqual } from 'node:crypto'

export type AuthResult = { ok: true } | { ok: false; reason: 'missing' | 'mismatch' }

const BEARER_PREFIX = 'Bearer '

function compareToken(expected: string, candidate: string): boolean {
  if (candidate.length !== expected.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'))
}

export function verifyToken(
  token: string,
  authorizationHeader: string | undefined,
  queryToken?: string | string[]
): AuthResult {
  if (token.length === 0) {
    return { ok: false, reason: 'missing' }
  }

  if (authorizationHeader !== undefined && authorizationHeader.startsWith(BEARER_PREFIX)) {
    const candidate = authorizationHeader.slice(BEARER_PREFIX.length)
    if (compareToken(token, candidate)) {
      return { ok: true }
    }
    return { ok: false, reason: 'mismatch' }
  }

  const queryCandidate = Array.isArray(queryToken) ? queryToken[0] : queryToken
  if (queryCandidate === undefined || queryCandidate.length === 0) {
    return { ok: false, reason: 'missing' }
  }
  if (compareToken(token, queryCandidate)) {
    return { ok: true }
  }
  return { ok: false, reason: 'mismatch' }
}
