import assert from 'node:assert'

import { roleMention, userMention } from 'discord.js'

import { Permission } from '../src/common/application-event'
import { translateNoPermission } from '../src/instance/discord/common/discord-language'

// Setup a fake application that returns a translator capturing options
function makeFakeApp(helperRoles: string[], officerRoles: string[], admins: string[]) {
  const app: any = {
    discordInstance: { getStaticConfig: () => ({ adminIds: admins }) },
    core: { discordConfigurations: { getHelperRoleIds: () => helperRoles, getOfficerRoleIds: () => officerRoles } },
    getTranslatorForBridge: () => (key: any, options?: any) =>
      `translated:${(options?.roles ?? []).length}:${(options?.admins ?? []).length}`
  }
  return app
}

// Roles only
{
  const app = makeFakeApp(['r1'], ['r2'], [])
  const out = translateNoPermission(app, Permission.Helper, 'b1')
  assert.strictEqual(out, 'translated:2:0')
}

// Admins only
{
  const app = makeFakeApp([], [], ['a1'])
  const out = translateNoPermission(app, Permission.Officer, 'b1')
  assert.strictEqual(out, 'translated:0:1')
}

// Both
{
  const app = makeFakeApp(['r1'], [], ['a1'])
  const out = translateNoPermission(app, Permission.Helper, 'b1')
  assert.strictEqual(out, 'translated:1:1')
}

console.log('PASS: discord-language translateNoPermission')
