import assert from 'node:assert'

import Application from '../src/application'

interface FakeCall {
  key: string
  opts: Record<string, unknown> | undefined
}

type MockApplication = {
  [K in keyof Application]: Application[K]
} & Record<string, unknown>

function makeFakeApp(dynamicLang?: string, staticLang?: string) {
  const calls: FakeCall[] = []
  const fakeI18n = {
    t: (key: string, options?: Record<string, unknown>) => {
      calls.push({ key, opts: options })
      return `translated:${key}:${options?.lng ?? 'undefined'}`
    }
  }

  const app = Object.create(Application.prototype) as MockApplication
  app.core = { bridgeConfigurations: { getLanguage: (_: string) => dynamicLang } }
  app.config = { bridges: staticLang ? [{ id: 'bridge1', language: staticLang }] : [] }
  app.i18n = fakeI18n

  return { app: app as unknown as Application, calls }
}

// Dynamic should override static
{
  const { app, calls } = makeFakeApp('de', 'en')
  const t = app.getTranslatorForBridge('bridge1')
  const res = t('some.key')
  assert.strictEqual(res, 'translated:some.key:de')
  assert.strictEqual(calls.length, 1)
}

// Static used when dynamic undefined
{
  const { app, calls } = makeFakeApp(undefined, 'ar')
  const t = app.getTranslatorForBridge('bridge1')
  const res = t('some.key')
  assert.strictEqual(res, 'translated:some.key:ar')
  assert.strictEqual(calls.length, 1)
}

// Fallback to global when neither defined
{
  const { app, calls } = makeFakeApp(undefined, undefined)
  const t = app.getTranslatorForBridge('bridge1')
  const res = t('some.key')
  assert.strictEqual(res, 'translated:some.key:undefined')
  assert.strictEqual(calls.length, 1)
}

console.log('PASS: application translator precedence')
