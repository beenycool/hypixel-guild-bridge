import assert from 'node:assert'

import type { i18n } from 'i18next'

import type Application from '../src/application.js'
import { Permission } from '../src/common/application-event'
import { translateNoPermission } from '../src/instance/discord/common/discord-language'

function buildTranslatorOutput(options: { roles?: string[]; admins?: string[] }): string {
  return `translated:${(options.roles ?? []).length}:${(options.admins ?? []).length}`
}

// Setup a fake application that returns a translator capturing options
function makeFakeApp(helperRoles: string[], officerRoles: string[], ownerRoles: string[], admins: string[]) {
  const app: {
    discordInstance: { getStaticConfig: () => { adminIds: string[] } }
    core: {
      discordConfigurations: {
        getHelperRoleIds: () => string[]
        getOfficerRoleIds: () => string[]
        getOwnerRoleIds: () => string[]
      }
      bridgeConfigurations: {
        getHelperRoleIds: () => string[]
        getOfficerRoleIds: () => string[]
        getOwnerRoleIds: () => string[]
      }
    }
    getTranslatorForBridge: () => (
      key: Parameters<i18n['t']>[0],
      options?: { roles?: string[]; admins?: string[] }
    ) => string
  } = {
    discordInstance: { getStaticConfig: () => ({ adminIds: admins }) },
    core: {
      discordConfigurations: {
        getHelperRoleIds: () => helperRoles,
        getOfficerRoleIds: () => officerRoles,
        getOwnerRoleIds: () => ownerRoles
      },
      bridgeConfigurations: {
        getHelperRoleIds: () => [],
        getOfficerRoleIds: () => [],
        getOwnerRoleIds: () => []
      }
    },
    getTranslatorForBridge: () => (_key: Parameters<i18n['t']>[0], options?: { roles?: string[]; admins?: string[] }) =>
      buildTranslatorOutput(options ?? {})
  }
  return app
}

// Roles only
{
  const app = makeFakeApp(['r1'], ['r2'], ['r3'], [])
  const out = translateNoPermission(app as unknown as Application, Permission.Helper, 'b1')
  // Helper roles (1) + Officer roles (1) + Owner roles (1) = 3 roles
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
  // Helper roles (1) + Officer roles (0) + Owner roles (0) = 1 role
  assert.strictEqual(out, 'translated:1:1')
}
