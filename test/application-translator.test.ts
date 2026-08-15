import assert from 'node:assert'

import type { i18n } from 'i18next'

import Application from '../src/application'

interface FakeCall {
  key: string
  opts: Record<string, unknown> | undefined
}

function makeFakeApp(dynamicLang?: string, staticLang?: string) {
  const calls: FakeCall[] = []
  const fakeI18n: i18n = {
    t: (key: string, options?: Record<string, unknown>) => {
      calls.push({ key, opts: options })
      const language = typeof options?.lng === 'string' ? options.lng : 'undefined'
      return `translated:${key}:${language}`
    }
  } as unknown as i18n

  const app = Object.create(Application.prototype) as Record<string, unknown>
  app.core = {
    bridgeConfigurations: {
      getLanguage: (bridgeId: string) => {
        void bridgeId
        return dynamicLang
      }
    }
  }
  app.config = { bridges: staticLang ? [{ id: 'bridge1', language: staticLang }] : [] }
  app.i18n = fakeI18n

  return { app: app as unknown as Application, calls }
}

{
  const { app, calls } = makeFakeApp('de', 'en')
  const translator = app.getTranslatorForBridge('bridge1')
  const result = translator('some.key')
  assert.strictEqual(result, 'translated:some.key:de')
  assert.strictEqual(calls.length, 1)
}

{
  const { app, calls } = makeFakeApp(undefined, 'ar')
  const translator = app.getTranslatorForBridge('bridge1')
  const result = translator('some.key')
  assert.strictEqual(result, 'translated:some.key:ar')
  assert.strictEqual(calls.length, 1)
}

{
  const { app, calls } = makeFakeApp(undefined, undefined)
  const translator = app.getTranslatorForBridge('bridge1')
  const result = translator('some.key')
  assert.strictEqual(result, 'translated:some.key:undefined')
  assert.strictEqual(calls.length, 1)
}

assert.ok(true, 'application translator precedence')
