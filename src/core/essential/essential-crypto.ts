import crypto from 'node:crypto'

const ESSENTIAL_SERVER_HASH = '173be201d4e5591dcef37bcaf701d136'

/**
 * Generate a 16-byte random shared secret for Essential auth.
 */
export function generateSharedSecret(): Buffer {
  return crypto.randomBytes(16)
}

/**
 * Compute the Essential session hash:
 *   SHA-1(sharedSecret || ESSENTIAL_SERVER_HASH_BYTES)
 * Formatted as a signed Java BigInteger hex string (Minecraft serverId style).
 */
export function computeEssentialSessionHash(sharedSecret: Buffer): string {
  const serverHashBytes = Buffer.from(ESSENTIAL_SERVER_HASH, 'hex')
  const sha1 = crypto.createHash('sha1')
  sha1.update(sharedSecret)
  sha1.update(serverHashBytes)
  const digest = sha1.digest()
  return formatServerId(digest)
}

/**
 * Format a SHA-1 digest as a Minecraft-style signed BigInteger hex string.
 * If the digest is negative in two's complement, the result starts with '-'.
 */
function formatServerId(digest: Buffer): string {
  const hex = digest.toString('hex')
  let number_ = BigInt('0x' + hex)
  const mask = 1n << 159n
  if (number_ & mask) {
    number_ = number_ - (1n << 160n)
  }
  return number_.toString(16)
}
