import assert from 'node:assert'
import http from 'node:http'
import { describe, it } from 'node:test'

import PackageJson from '../package.json' with { type: 'json' }
import type Application from '../src/application.js'
import WebServer from '../src/instance/web-server.js'

void describe('web server /health', () => {
  void it('returns status ok, uptime number and version', async () => {
    const app = {
      emit: () => {},
      on: () => {},
      onAny: () => {},
      addShutdownListener: () => {},
      sendMinecraft: async () => {},
      getInstancesNames: () => [],
      i18n: { t: () => '' }
    } as unknown as Application
    const server = new WebServer(app, { port: 0, token: 'test', enabled: true })

    // wait for server to bind to ephemeral port
    await new Promise<void>((resolve) => {
      const httpServer = (server as any).httpServer as http.Server
      httpServer.once('listening', () => {
        resolve()
      })
    })

    const address = (server as any).httpServer.address()
    const port = address.port

    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/health`, (res) => {
          let data = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            resolve(data)
          })
        })
        .on('error', reject)
    })

    const json = JSON.parse(body)
    assert.strictEqual(json.status, 'ok')
    assert.strictEqual(typeof json.uptime, 'number')
    assert.strictEqual(json.version, PackageJson.version)

    // close underlying server
    ;((server as any).httpServer as http.Server).close()
  })
})
