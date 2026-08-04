import type { Permission } from '../../common/application-event.js'

import { verifySignedToken } from './signed-token.js'

export type AuthResult =
  | { ok: true; permission: Permission; userId?: string }
  | { ok: false; reason: 'missing' | 'mismatch' }

export interface TokenSet {
  signingSecret: string
}

export function buildTokenSet(config: { signingSecret?: string }): TokenSet {
  return { signingSecret: config.signingSecret ?? '' }
}

const BEARER_PREFIX = 'Bearer '

export function verifyToken(
  tokens: TokenSet,
  authorizationHeader: string | undefined,
  queryToken?: string | string[]
): AuthResult {
  if (!tokens.signingSecret) {
    return { ok: false, reason: 'missing' }
  }

  const candidate = extractCandidate(authorizationHeader, queryToken)
  if (candidate === undefined || candidate.length === 0) {
    return { ok: false, reason: 'missing' }
  }

  const payload = verifySignedToken(candidate, tokens.signingSecret)
  if (payload === undefined) {
    return { ok: false, reason: 'mismatch' }
  }

  return { ok: true, permission: payload.perm as Permission, userId: payload.sub }
}

function extractCandidate(authorizationHeader: string | undefined, queryToken?: string | string[]): string | undefined {
  if (authorizationHeader?.startsWith(BEARER_PREFIX) === true) {
    return authorizationHeader.slice(BEARER_PREFIX.length)
  }

  const qc = Array.isArray(queryToken) ? queryToken[0] : queryToken
  if (qc !== undefined && qc.length > 0) return qc
  return undefined
}
