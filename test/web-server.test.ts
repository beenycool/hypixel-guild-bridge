import assert from 'node:assert'
import { describe, it } from 'node:test'
import http from 'node:http'

import PackageJson from '../package.json' with { type: 'json' }
import WebServer from '../src/instance/web-server.js'

const makeFakeApp = () => ({
  on: () => {},
  onAny: () => {},
  addShutdownListener: () => {},
  sendMinecraft: async () => {},
  getInstancesNames: () => [],
  i18n: { t: () => '' }
} as any)

void describe('web server /health', () => {
  void it('returns status ok, uptime number and version', async () => {
    const app = makeFakeApp()
    const server = new WebServer(app, { port: 0, token: 'test' })

    // wait for server to bind to ephemeral port
    await new Promise<void>((resolve) => {
      const httpServer = (server as any).httpServer as http.Server
      httpServer.once('listening', () => resolve())
    })

    const address = (server as any).httpServer.address() as any
    const port = address.port

    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve(data))
      }).on('error', reject)
    })

    const json = JSON.parse(body)
    assert.strictEqual(json.status, 'ok')
    assert.strictEqual(typeof json.uptime, 'number')
    assert.strictEqual(json.version, PackageJson.version)

    // close underlying server
    ;((server as any).httpServer as http.Server).close()
  })
})
