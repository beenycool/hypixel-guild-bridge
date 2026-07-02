import assert from 'node:assert'

import type { i18n } from 'i18next'

import type Application from '../src/application.js'
import { Permission } from '../src/common/application-event'
import { translateNoPermission } from '../src/instance/discord/common/discord-language'

interface TranslatorOptions {
  roles?: string[]
  admins?: string[]
}

function buildTranslatorOutput(options: TranslatorOptions): string {
  return `translated:${(options.roles ?? []).length}:${(options.admins ?? []).length}`
}

function fakeTranslator(key: Parameters<i18n['t']>[0], options?: TranslatorOptions): string {
  void key
  return buildTranslatorOutput(options ?? {})
}

interface FakeApp {
  discordInstance: { getStaticConfig: () => { adminIds: string[] } }
  core: {
    discordConfigurations: {
      getHelperRoleIds: () => string[]
      getOfficerRoleIds: () => string[]
      getOwnerRoleIds: () => string[]
    }
    bridgeConfigurations: {
      getHelperRoleIds: () => string[]
      getOwnerRoleIds: () => string[]
    }
  }
  getTranslatorForBridge: () => (key: Parameters<i18n['t']>[0], options?: TranslatorOptions) => string
}

function makeFakeApp(helperRoles: string[], officerRoles: string[], ownerRoles: string[], admins: string[]): FakeApp {
  return {
    discordInstance: { getStaticConfig: () => ({ adminIds: admins }) },
    core: {
      discordConfigurations: {
        getHelperRoleIds: () => helperRoles,
        getOfficerRoleIds: () => officerRoles,
        getOwnerRoleIds: () => ownerRoles
      },
      bridgeConfigurations: {
        getHelperRoleIds: () => [],
        getOwnerRoleIds: () => []
      }
    },
    getTranslatorForBridge: () => fakeTranslator
  }
}

// Roles only
{
  const app = makeFakeApp(['r1'], ['r2'], ['r3'], [])
  const out = translateNoPermission(app as unknown as Application, Permission.Helper, 'b1')
  assert.strictEqual(out, 'translated:3:0')
}

// Admins only
{
  const app = makeFakeApp([], [], [], ['a1'])
  const out = translateNoPermission(app as unknown as Application, Permission.Officer, 'b1')
  assert.strictEqual(out, 'translated:0:1')
}

// Owner only test
{
  const app = makeFakeApp([], [], ['r3'], [])
  const out = translateNoPermission(app as unknown as Application, Permission.Owner, 'b1')
  assert.strictEqual(out, 'translated:1:0')
}

// Both
{
  const app = makeFakeApp(['r1'], [], [], ['a1'])
  const out = translateNoPermission(app as unknown as Application, Permission.Helper, 'b1')
  assert.strictEqual(out, 'translated:1:1')
}
