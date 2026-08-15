export function decodePacket(data: Buffer): { typeId: number; packetId: string; json: unknown } {
  let offset = 0
  const typeId = data.readInt32BE(offset)
  offset += 4
  const packetIdLength = data.readInt32BE(offset)
  offset += 4
  const packetId = data.subarray(offset, offset + packetIdLength).toString('utf8')
  offset += packetIdLength
  const jsonLength = data.readInt32BE(offset)
  offset += 4
  const jsonString = data.subarray(offset, offset + jsonLength).toString('utf8')
  const json: unknown = jsonString.length > 0 ? JSON.parse(jsonString) : {}
  return { typeId, packetId, json }
}

export function encodePacket(typeId: number, packetId: string, json: unknown): Buffer {
  const packetIdBuf = Buffer.from(packetId, 'utf8')
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')

  const buf = Buffer.alloc(4 + 4 + packetIdBuf.length + 4 + jsonBuf.length)
  let offset = 0
  buf.writeInt32BE(typeId, offset)
  offset += 4
  buf.writeInt32BE(packetIdBuf.length, offset)
  offset += 4
  packetIdBuf.copy(buf, offset)
  offset += packetIdBuf.length
  buf.writeInt32BE(jsonBuf.length, offset)
  offset += 4
  jsonBuf.copy(buf, offset)

  return buf
}
