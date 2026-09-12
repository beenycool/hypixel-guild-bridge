import crypto from 'node:crypto'
import https from 'node:https'

import type { Logger } from 'log4js'
import NodeCache from 'node-cache'
import WebSocket from 'ws'

import type Application from '../../application.js'
import { Status } from '../../common/connectable-instance.js'

// essential client detecton, based on https://github.com/ohlunaaa/essential-protocol
// the socket is binary and every packet is json wrapped in a little binary header
const WSS_URL = 'wss://connect.essential.gg/v1'
const JOIN_URL = 'https://sessionserver.mojang.com/session/minecraft/join'
const CONST = Buffer.from('173be201d4e5591dcef37bcaf701d136', 'hex')

const SUB_PACKET = 'subscription.SubscriptionUpdatePacket'
const KEEP_ALIVE = 'connection.ConnectionKeepAlivePacket'
const STATUS_PACKET = 'profile.ServerProfileStatusPacket'

function getSecret() {
  return crypto.randomBytes(16)
}

// sha1(secret + const) then the same weird signed hex mojang uses for serverId
function getSessionHash(secret: Buffer) {
  var sha = crypto.createHash('sha1')
  sha.update(secret)
  sha.update(CONST)
  var digest = sha.digest()
  var num = BigInt('0x' + digest.toString('hex'))
  if (num & (1n << 159n)) {
    num = num - (1n << 160n)
  }
  return num.toString(16)
}

// int32 typeId, int32 len + packetId, int32 len + json
function makeFrame(typeId: number, packetId: string, json: any) {
  var idBuf = Buffer.from(packetId, 'utf8')
  var jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  var buf = Buffer.alloc(4 + 4 + idBuf.length + 4 + jsonBuf.length)
  var off = 0
  buf.writeInt32BE(typeId, off)
  off += 4
  buf.writeInt32BE(idBuf.length, off)
  off += 4
  idBuf.copy(buf, off)
  off += idBuf.length
  buf.writeInt32BE(jsonBuf.length, off)
  off += 4
  jsonBuf.copy(buf, off)
  return buf
}

function readFrame(data: any) {
  var off = 0
  var typeId = data.readInt32BE(off)
  off += 4
  var idLen = data.readInt32BE(off)
  off += 4
  var packetId = data.subarray(off, off + idLen).toString('utf8')
  off += idLen
  var jsonLen = data.readInt32BE(off)
  off += 4
  var raw = data.subarray(off, off + jsonLen).toString('utf8')
  var json = raw.length > 0 ? JSON.parse(raw) : {}
  return { typeId: typeId, packetId: packetId, json: json }
}

export class EssentialService {
  private cache: NodeCache
  private ws: any
  private incoming: any = {}
  private outgoing: any = {}
  private nextId = 1
  private waiters: any = {}
  private connecting: any
  private lastFail = 0
  private cooldown = 5000
  private lastMsg = 0
  private pingTimer: any

  constructor(
    private app: Application,
    private logger: Logger,
    private instanceName?: string,
    cacheSeconds = 60
  ) {
    this.cache = new NodeCache({ stdTTL: cacheSeconds })
  }

  private getCredentials() {
    const instances = this.app.minecraftManager.getAllInstances()
    const targetName = this.instanceName?.toLowerCase()

    const found =
      targetName === undefined
        ? instances.find((instance) => instance.currentStatus() === Status.Connected)
        : instances.find(
            (instance) =>
              instance.instanceName.toLowerCase() === targetName && instance.currentStatus() === Status.Connected
          )

    return found?.getLunarCredentials()
  }

  public async checkEssentialStatus(uuid: string) {
    var key = uuid.toLowerCase().split('-').join('')
    var cached = this.cache.get(key)
    if (cached !== undefined) {
      return cached
    }

    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.ensureConnected()
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return undefined
      }
      var online = await this.askStatus(uuid)
      this.cache.set(key, online)
      return online
    } catch (e) {
      return undefined
    }
  }

  public ensureConnected() {
    var self = this
    if (self.connecting) {
      return self.connecting
    }
    self.connecting = self.connect().then(function () {
      self.connecting = undefined
    })
    return self.connecting
  }

  private async connect() {
    var creds = this.getCredentials()
    if (!creds) {
      this.logger.info('[EssentialService] no connected minecraft account to auth with')
      return
    }

    if (Date.now() - this.lastFail < this.cooldown) {
      // mojang got mad last time so wait a bit
      return
    }

    try {
      this.logger.info('[EssentialService] connecting as ' + creds.username + '...')
      var secret = getSecret()
      await this.joinServer(creds.accessToken, creds.uuid, getSessionHash(secret))
      await this.openSocket(creds.uuid, creds.username, secret)
      this.cooldown = 5000
      this.logger.info('[EssentialService] connected to essential!')
    } catch (e) {
      this.lastFail = Date.now()
      this.cooldown = this.cooldown * 2
      if (this.cooldown > 60000) {
        this.cooldown = 60000
      }
      this.logger.warn('[EssentialService] could not connect', e)
    }
  }

  private joinServer(token: string, uuid: string, serverId: string) {
    return new Promise(function (resolve: any, reject: any) {
      var body = JSON.stringify({
        accessToken: token,
        selectedProfile: uuid.replace(/-/g, ''),
        serverId: serverId
      })

      var url = new URL(JOIN_URL)
      var req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'User-Agent': 'Essential 1.3.4.1'
          }
        },
        function (res: any) {
          if (res.statusCode == 204 || (res.statusCode >= 200 && res.statusCode < 300)) {
            resolve(null)
          } else {
            reject(new Error('join server said ' + res.statusCode))
          }
        }
      )
      req.on('error', function (err: any) {
        reject(err)
      })
      req.write(body)
      req.end()
    })
  }

  private openSocket(uuid: string, username: string, secret: Buffer) {
    var self = this
    return new Promise(function (resolve: any, reject: any) {
      var pass = Buffer.concat([Buffer.from(username + ':', 'utf8'), secret]).toString('base64')
      var sock = new WebSocket(WSS_URL, {
        headers: {
          Authorization: 'Basic ' + pass,
          'Essential-User-UUID': uuid,
          'Essential-User-Name': username,
          'Essential-Max-Protocol-Version': '11',
          'Essential-Mod-Version': '1.3.4.1',
          'Essential-Mod-Branch': 'stable',
          'Essential-Mod-Commit': '0000000',
          'User-Agent': 'Essential 1.3.4.1'
        }
      })

      var opened = false

      sock.on('open', function () {
        opened = true
        self.ws = sock
        self.incoming = {}
        self.outgoing = {}
        self.nextId = 1
        self.lastMsg = Date.now()
        self.startPing()
        resolve(null)
      })

      sock.on('message', function (data: any) {
        self.lastMsg = Date.now()
        self.onMessage(data)
      })

      sock.on('pong', function () {
        self.lastMsg = Date.now()
      })

      sock.on('close', function (code: any, reason: any) {
        self.logger.warn('[EssentialService] socket closed ' + code + ' ' + reason)
        self.stopPing()
        if (self.ws === sock) {
          self.ws = undefined
        }
        for (var k in self.waiters) {
          self.waiters[k](false)
          delete self.waiters[k]
        }
      })

      sock.on('error', function (err: any) {
        self.logger.warn('[EssentialService] socket error', err)
        self.stopPing()
        if (self.ws === sock) {
          self.ws = undefined
        }
        if (!opened) {
          reject(err)
        }
      })
    })
  }

  private onMessage(data: any) {
    var msg
    try {
      msg = readFrame(data)
    } catch (e) {
      return
    }

    // type id 0 = the server telling us which id a packet name uses
    if (msg.typeId === 0) {
      if (msg.json && typeof msg.json.a === 'string') {
        this.incoming[msg.json.b] = msg.json.a
      }
      return
    }

    var name = this.incoming[msg.typeId]

    if (name === KEEP_ALIVE) {
      this.sendPacket(KEEP_ALIVE, {}, msg.packetId)
      return
    }

    if (name === STATUS_PACKET) {
      if (!msg.json || !msg.json.a) {
        return
      }
      var key = String(msg.json.a).toLowerCase().split('-').join('')
      var waiter = this.waiters[key]
      if (waiter) {
        delete this.waiters[key]
        waiter(msg.json.b === 'ONLINE')
      }
    }
  }

  private askStatus(uuid: string) {
    var self = this
    var key = uuid.toLowerCase().split('-').join('')
    return new Promise(function (resolve: any) {
      var timer = setTimeout(function () {
        delete self.waiters[key]
        self.subscribe(uuid, false)
        resolve(false)
      }, 1800)

      self.waiters[key] = function (online: any) {
        clearTimeout(timer)
        self.subscribe(uuid, false)
        resolve(online)
      }

      self.subscribe(uuid, true)
    })
  }

  private subscribe(uuid: string, on: boolean) {
    this.sendPacket(SUB_PACKET, { a: [uuid], b: false, c: on })
  }

  private sendPacket(name: string, json: any, packetId?: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    // the first time we use a packet we have to register our own id for it
    if (this.outgoing[name] === undefined) {
      this.outgoing[name] = this.nextId
      this.ws.send(makeFrame(0, '', { a: name, b: this.nextId }))
      this.nextId = this.nextId + 1
    }

    this.ws.send(makeFrame(this.outgoing[name], packetId || '', json))
  }

  private startPing() {
    var self = this
    this.stopPing()
    this.pingTimer = setInterval(function () {
      if (!self.ws || self.ws.readyState !== WebSocket.OPEN) {
        self.stopPing()
        return
      }
      self.ws.ping()
    }, 30000)
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = undefined
    }
  }
}
