import crypto from 'node:crypto'

const ESSENTIAL_SERVER_HASH = '173be201d4e5591dcef37bcaf701d136'

export function generateSharedSecret(): Buffer {
  return crypto.randomBytes(16)
}

export function computeEssentialSessionHash(sharedSecret: Buffer): string {
  const serverHashBytes = Buffer.from(ESSENTIAL_SERVER_HASH, 'hex')
  const sha1 = crypto.createHash('sha1')
  sha1.update(sharedSecret)
  sha1.update(serverHashBytes)
  const digest = sha1.digest()
  return formatServerId(digest)
}

function formatServerId(digest: Buffer): string {
  const hex = digest.toString('hex')
  let value = BigInt('0x' + hex)
  const mask = 1n << 159n
  if (value & mask) {
    value = value - (1n << 160n)
  }
  return value.toString(16)
}
