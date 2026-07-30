import crypto from 'node:crypto'

export function sha1Hex(...buffers: Buffer[]): Buffer {
  const h = crypto.createHash('sha1')
  for (const buf of buffers) h.update(buf)
  return h.digest()
}

export function formatServerId(digest: Buffer): string {
  const hex = digest.toString('hex')
  let num = BigInt('0x' + hex)
  const mask = 1n << 159n
  if (num & mask) {
    num = num - (1n << 160n)
  }
  return num.toString(16)
}

export function generateAesKey(): Buffer {
  return crypto.randomBytes(16)
}

export function generateNonce(len = 16): Buffer {
  return crypto.randomBytes(len)
}

export function rsaEncryptPkcs1(data: Buffer, derPubKey: Buffer): Buffer {
  const keyObj = crypto.createPublicKey({
    key: derPubKey,
    type: 'spki',
    format: 'der'
  })
  return crypto.publicEncrypt(
    { key: keyObj, padding: crypto.constants.RSA_PKCS1_PADDING },
    data
  )
}
