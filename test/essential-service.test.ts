import assert from 'node:assert/strict'
import test from 'node:test'

import type { Logger } from 'log4js'

import type Application from '../src/application.js'
import { EssentialService } from '../src/core/essential/essential-service.js'

const noop = (): void => {
  /* noop */
}

await test('EssentialService returns undefined when no connected instance is available', async () => {
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

  const essentialService = new EssentialService(dummyApp, dummyLogger, undefined, 60)
  const result = await essentialService.checkEssentialStatus('00000000-0000-0000-0000-000000000000')

  assert.equal(result, undefined)
})
