import assert from 'node:assert'

import { InstanceMessageType } from '../src/common/application-event'
import { Status } from '../src/common/connectable-instance'
import type { Translator } from '../src/core/instance/instance-language'
import {
  translateAuthenticationCodeExpired,
  translateInstanceMessage,
  translateInstanceStatus
} from '../src/core/instance/instance-language'

function extractOptionField(options: unknown, field: string): string | undefined {
  return (options as Record<string, string> | undefined)?.[field]
}

const TestTranslator: Translator = (key, options) => {
  void key
  return `translated:${extractOptionField(options, 'from') ?? extractOptionField(options, 'to') ?? extractOptionField(options, 'instanceName') ?? ''}`
}

// message type
{
  const out = translateInstanceMessage(TestTranslator, InstanceMessageType.MinecraftAuthenticationCode)
  assert.strictEqual(out, 'translated:')
}

// auth expired
{
  const out = translateAuthenticationCodeExpired(TestTranslator)
  assert.strictEqual(out, 'translated:')
}

// status change
{
  const out = translateInstanceStatus(TestTranslator, { from: Status.Connected, to: Status.Disconnected })
  assert.ok(out.startsWith('translated:'))
}

assert.ok(true, 'instance-language translator usage')
