import assert from 'node:assert/strict'
import test from 'node:test'
import type Application from '../src/application.js'
import { FeatherService } from '../src/core/feather/feather-service.js'

test('FeatherService returns undefined when no connected instance is available', async () => {
  const dummyLogger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  } as any

  const dummyApp = {
    minecraftManager: {
      getAllInstances: () => []
    }
  } as unknown as Application

  const featherService = new FeatherService(dummyApp, dummyLogger, undefined, 60)
  const result = await featherService.checkFeatherStatus('00000000-0000-0000-0000-000000000000')

  assert.equal(result, undefined)
})
