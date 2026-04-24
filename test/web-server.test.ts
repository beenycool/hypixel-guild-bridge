import assert from 'node:assert'
import http from 'node:http'
import { describe, it } from 'node:test'

import PackageJson from '../package.json' with { type: 'json' }
import type Application from '../src/application.js'
import WebServer from '../src/instance/web-server.js'

await describe('web server /health', async () => {
  await it('returns status ok, uptime number and version', async () => {
    const app = {
      emit: () => {
        /* noop */
      },
      on: () => {
        /* noop */
      },
      onAny: () => {
        /* noop */
      },
      addShutdownListener: () => {
        /* noop */
      },
      sendMinecraft: async () => {
        /* noop */
      },
      getInstancesNames: () => [],
      i18n: { t: () => '' }
    } as unknown as Application
    const server = new WebServer(app, { port: 0, token: 'test', enabled: true })

    await new Promise<void>((resolve) => {
      const httpServer = (server as unknown as { httpServer: http.Server }).httpServer
      httpServer.once('listening', () => {
        resolve()
      })
    })

    const address = (server as unknown as { httpServer: { address(): { port: number } } }).httpServer.address()
    const port = address.port

    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${String(port)}/health`, (response) => {
          let data = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => (data += chunk))
          response.on('end', () => {
            resolve(data)
          })
        })
        .on('error', reject)
    })

    const json = JSON.parse(body) as { status: string; uptime: number; version: string }
    assert.strictEqual(json.status, 'ok')
    assert.strictEqual(typeof json.uptime, 'number')
    assert.strictEqual(json.version, PackageJson.version)
    ;(server as unknown as { httpServer: http.Server }).httpServer.close()
  })
})
