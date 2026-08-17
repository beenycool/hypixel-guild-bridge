import crypto from 'node:crypto'

export function sha1Hex(...buffers: Buffer[]): Buffer {
  const hash = crypto.createHash('sha1')
  for (const buffer of buffers) hash.update(buffer)
  return hash.digest()
}

// minecraft's cursed two's complement sha1 hex formatting (why did notch do it this way lol)
export function formatServerId(digest: Buffer): string {
  const hex = digest.toString('hex')
  let value = BigInt('0x' + hex)
  const mask = 1n << 159n
  if (value & mask) {
    value = value - (1n << 160n)
  }
  return value.toString(16)
}

export function generateAesKey(): Buffer {
  return crypto.randomBytes(16)
}

export function rsaEncryptPkcs1(data: Buffer, derPubKey: Buffer): Buffer {
  const keyObject = crypto.createPublicKey({
    key: derPubKey,
    type: 'spki',
    format: 'der'
  })
  return crypto.publicEncrypt({ key: keyObject, padding: crypto.constants.RSA_PKCS1_PADDING }, data)
}
