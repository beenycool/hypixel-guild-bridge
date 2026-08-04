import assert from 'node:assert/strict'
import test from 'node:test'

import type { Logger } from 'log4js'

import type Application from '../src/application.js'
import { FeatherService } from '../src/core/feather/feather-service.js'

const noop = (): void => {
  /* noop */
}

await test('FeatherService returns undefined when no connected instance is available', async () => {
  const dummyLogger: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop
  } as unknown as Logger

  const dummyApp = {
    minecraftManager: {
      getAllInstances: () => []
    }
  } as unknown as Application

  const featherService = new FeatherService(dummyApp, dummyLogger, undefined, 60)
  const result = await featherService.checkFeatherStatus('00000000-0000-0000-0000-000000000000')

  assert.equal(result, undefined)
})
