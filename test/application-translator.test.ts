import assert from 'node:assert'

import Application from '../src/application'

function makeFakeApp(dynamicLang?: string, staticLang?: string) {
  const calls: any[] = []
  const fakeI18n = {
    t: (key: any, options?: any) => {
      calls.push({ key, opts: options })
      return `translated:${key}:${options?.lng ?? 'undefined'}`
    }
  }

  const app: any = Object.create(Application.prototype)
  app.core = { bridgeConfigurations: { getLanguage: (_: string) => dynamicLang } }
  app.config = { bridges: staticLang ? [{ id: 'bridge1', language: staticLang }] : [] }
  app.i18n = fakeI18n

  return { app, calls }
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
