import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Long from 'long'
import protobuf from 'protobufjs'

import { rsaEncryptPkcs1 } from './lunar-crypto.js'

let root: protobuf.Root | null = null

export async function loadProto(): Promise<protobuf.Root> {
  if (root) return root
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const protoDir = path.join(__dirname, 'proto')
  root = await protobuf.load([
    path.join(protoDir, 'common.proto'),
    path.join(protoDir, 'authenticator.proto'),
    path.join(protoDir, 'websocket.proto'),
    path.join(protoDir, 'subscription.proto')
  ])
  return root
}

export function uuidToHighLow(uuid: string): { high: Long; low: Long } {
  const hex = uuid.replaceAll('-', '')
  return {
    high: Long.fromString(hex.substring(0, 16), true, 16),
    low: Long.fromString(hex.substring(16, 32), true, 16)
  }
}

export function highLowToUuid(high: unknown, low: unknown): string {
  const h = Long.fromValue(high as Long | number | string).toUnsigned().toString(16).padStart(16, '0')
  const l = Long.fromValue(low as Long | number | string).toUnsigned().toString(16).padStart(16, '0')
  const hex = h + l
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32)
  ].join('-')
}

export function encodeUuid(uuid: string): { high: Long; low: Long } {
  return uuidToHighLow(uuid)
}

export function decodeUuid(protoUuid: { high: unknown; low: unknown }): string {
  return highLowToUuid(protoUuid.high, protoUuid.low)
}

export async function encodeAuthHello(uuid: string, username: string): Promise<Buffer> {
  const r = await loadProto()
  const ServerboundAuth = r.lookupType('lunarclient.authenticator.v1.ServerboundAuthMessage')
  const msg = ServerboundAuth.create({
    hello: {
      identity: {
        uuid: encodeUuid(uuid),
        username
      },
      initiator: 'assetServer'
    }
  })
  return Buffer.from(ServerboundAuth.encode(msg).finish())
}

export async function decodeAuthMessage(data: Buffer): Promise<any> {
  const r = await loadProto()
  const AuthMessage = r.lookupType('lunarclient.authenticator.v1.ClientboundAuthMessage')
  return AuthMessage.decode(data)
}

export async function encodeAuthEncryptionResponse(
  aesKey: Buffer,
  nonce: Buffer,
  serverPublicKeyDer: Buffer
): Promise<Buffer> {
  const r = await loadProto()
  const ServerboundAuth = r.lookupType('lunarclient.authenticator.v1.ServerboundAuthMessage')

  const encryptedSecret = rsaEncryptPkcs1(aesKey, serverPublicKeyDer)
  const encryptedNonce = rsaEncryptPkcs1(nonce, serverPublicKeyDer)

  const msg = ServerboundAuth.create({
    encryptionResponse: {
      secretKey: encryptedSecret,
      publicKey: encryptedNonce
    }
  })
  return Buffer.from(ServerboundAuth.encode(msg).finish())
}

export async function encodeHandshake(uuid: string, username: string, jwt: string): Promise<Buffer> {
  const r = await loadProto()
  const Handshake = r.lookupType('lunarclient.websocket.v1.Handshake')
  const msg = Handshake.create({
    identity: {
      player: {
        uuid: encodeUuid(uuid),
        username
      },
      type: 1,
      authenticatorJwt: jwt
    },
    versionInfo: {
      version: '2.16.0'
    },
    os: process.platform === 'darwin' ? 'darwin' : 'linux',
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    language: {
      language: 'eng',
      locale: 'en_US'
    },
    gameBlock: {
      minecraftVersion: { version: '1.8.9' },
      lunarClientVersion: {
        branch: 'master',
        gitCommit: 'a1b2c3d4e5f6a7b8',
        version: '2.16.0'
      }
    }
  })
  return Buffer.from(Handshake.encode(msg).finish())
}

export async function encodeRpcMessage(
  requestId: string | number,
  service: string,
  method: string,
  inputBytes?: Buffer
): Promise<Buffer> {
  const r = await loadProto()
  const ServerboundWs = r.lookupType('lunarclient.websocket.v1.ServerboundWebSocketMessage')
  const msg = ServerboundWs.create({
    requestId: Buffer.from(requestId.toString()),
    service,
    method,
    input: inputBytes ?? Buffer.alloc(0)
  })
  return Buffer.from(ServerboundWs.encode(msg).finish())
}

export async function decodeWsMessage(data: Buffer): Promise<any> {
  const r = await loadProto()
  const ClientboundWs = r.lookupType('lunarclient.websocket.v1.ClientboundWebSocketMessage')
  return ClientboundWs.decode(data)
}

export async function encodeSubscribeV2(uuids: string[]): Promise<Buffer> {
  const r = await loadProto()
  const SubscribeV2Req = r.lookupType('lunarclient.websocket.subscription.v1.SubscribeV2Request')
  const msg = SubscribeV2Req.create({
    targetUuids: uuids.map((uuid) => encodeUuid(uuid))
  })
  return Buffer.from(SubscribeV2Req.encode(msg).finish())
}

export async function decodeSubscribeV2Response(data: Buffer): Promise<any> {
  const r = await loadProto()
  const SubscribeV2Resp = r.lookupType('lunarclient.websocket.subscription.v1.SubscribeV2Response')
  return SubscribeV2Resp.decode(data)
}
