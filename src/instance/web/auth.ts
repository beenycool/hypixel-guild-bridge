import type { Permission } from '../../common/application-event.js'

import { verifySignedToken } from './signed-token.js'

export type AuthResult =
  | { ok: true; permission: Permission; userId?: string; bridgeId?: string }
  | { ok: false; reason: 'missing' | 'mismatch' }

interface TokenSet {
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

  return { ok: true, permission: payload.perm as Permission, userId: payload.sub, bridgeId: payload.bridge }
}

export function authorizeBridge(
  auth: AuthResult,
  requestedBridgeId: string | undefined,
  minimumPermission: Permission
): { ok: true } | { ok: false; status: number; message: string } {
  if (!auth.ok) {
    return { ok: false, status: 401, message: 'Invalid token' }
  }
  if (auth.permission < minimumPermission) {
    return { ok: false, status: 403, message: 'Insufficient permissions' }
  }
  if (requestedBridgeId === undefined || requestedBridgeId.length === 0) {
    return { ok: false, status: 400, message: 'bridgeId is required' }
  }
  if (auth.bridgeId === undefined) {
    return { ok: false, status: 403, message: 'Token is not bound to a bridge' }
  }
  if (auth.bridgeId !== requestedBridgeId) {
    return { ok: false, status: 403, message: 'Token is not authorized for this bridge' }
  }

  return { ok: true }
}

function extractCandidate(authorizationHeader: string | undefined, queryToken?: string | string[]): string | undefined {
  if (authorizationHeader?.startsWith(BEARER_PREFIX) === true) {
    return authorizationHeader.slice(BEARER_PREFIX.length)
  }

  const qc = Array.isArray(queryToken) ? queryToken[0] : queryToken
  if (qc !== undefined && qc.length > 0) return qc
  return undefined
}
