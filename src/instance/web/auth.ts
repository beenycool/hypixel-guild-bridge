import { timingSafeEqual } from 'node:crypto'

import { Permission } from '../../common/application-event.js'
import { verifySignedToken } from './signed-token.js'

export type AuthResult =
  | { ok: true; permission: Permission; userId?: string }
  | { ok: false; reason: 'missing' | 'mismatch' }

export interface TokenSet {
  admin: string
  owner?: string
  helper?: string
  signingSecret?: string
}

const BEARER_PREFIX = 'Bearer '

const PERMISSION_ORDER = [Permission.Admin, Permission.Owner, Permission.Helper]

function getTokenForPermission(tokens: TokenSet, permission: Permission): string | undefined {
  switch (permission) {
    case Permission.Admin:
      return tokens.admin
    case Permission.Owner:
      return tokens.owner ?? tokens.admin
    case Permission.Helper:
      return tokens.helper ?? tokens.admin
    default:
      return undefined
  }
}

function compareToken(expected: string, candidate: string): boolean {
  if (candidate.length !== expected.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'))
}

export function buildTokenSet(config: {
  token: string
  helperToken?: string
  ownerToken?: string
  signingSecret?: string
}): TokenSet {
  return {
    admin: config.token,
    owner: config.ownerToken,
    helper: config.helperToken,
    signingSecret: config.signingSecret
  }
}

export function verifyToken(
  tokens: TokenSet,
  authorizationHeader: string | undefined,
  queryToken?: string | string[]
): AuthResult {
  const candidate = extractCandidate(authorizationHeader, queryToken)
  if (candidate === undefined || candidate.length === 0) {
    return { ok: false, reason: 'missing' }
  }

  if (tokens.signingSecret) {
    const signedPayload = verifySignedToken(candidate, tokens.signingSecret)
    if (signedPayload) {
      return { ok: true, permission: signedPayload.perm as Permission, userId: signedPayload.sub }
    }
  }

  if (tokens.admin.length === 0) {
    return { ok: false, reason: 'missing' }
  }

  for (const permission of PERMISSION_ORDER) {
    const expected = getTokenForPermission(tokens, permission)
    if (expected !== undefined && expected.length > 0 && compareToken(expected, candidate)) {
      return { ok: true, permission }
    }
  }

  return { ok: false, reason: 'mismatch' }
}

function extractCandidate(authorizationHeader: string | undefined, queryToken?: string | string[]): string | undefined {
  if (authorizationHeader !== undefined && authorizationHeader.startsWith(BEARER_PREFIX)) {
    return authorizationHeader.slice(BEARER_PREFIX.length)
  }

  const qc = Array.isArray(queryToken) ? queryToken[0] : queryToken
  if (qc !== undefined && qc.length > 0) return qc
  return undefined
}

export function requirePermission(
  result: AuthResult,
  minimum: Permission
): result is { ok: true; permission: Permission } {
  return result.ok && result.permission >= minimum
}
