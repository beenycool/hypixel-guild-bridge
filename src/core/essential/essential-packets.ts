/**
 * Decode an Essential binary WebSocket frame.
 * Layout: int32be typeId | int32be packetIdLen | utf8 packetId | int32be jsonLen | utf8 json
 */
export function decodePacket(data: Buffer): { typeId: number; packetId: string; json: unknown } {
  let offset = 0
  const typeId = data.readInt32BE(offset)
  offset += 4
  const packetIdLen = data.readInt32BE(offset)
  offset += 4
  const packetId = data.subarray(offset, offset + packetIdLen).toString('utf8')
  offset += packetIdLen
  const jsonLen = data.readInt32BE(offset)
  offset += 4
  const jsonStr = data.subarray(offset, offset + jsonLen).toString('utf8')
  const json = jsonStr.length > 0 ? JSON.parse(jsonStr) : {}
  return { typeId, packetId, json }
}

/**
 * Encode an Essential binary WebSocket frame.
 */
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
