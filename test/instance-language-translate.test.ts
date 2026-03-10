import assert from 'node:assert'

import { InstanceMessageType } from '../src/common/application-event'
import { Status } from '../src/common/connectable-instance'
import {
  translateAuthenticationCodeExpired,
  translateInstanceMessage,
  translateInstanceStatus
} from '../src/core/instance/instance-language'

const t = (k: any, options?: any) => `translated:${options?.from ?? options?.to ?? options?.instanceName ?? ''}`

// message type
{
  const out = translateInstanceMessage(t as any, InstanceMessageType.MinecraftAuthenticationCode)
  assert.strictEqual(out, 'translated:')
}

// auth expired
{
  const out = translateAuthenticationCodeExpired(t as any)
  assert.strictEqual(out, 'translated:')
}

// status change
{
  const out = translateInstanceStatus(t as any, { from: Status.Connected, to: Status.Disconnected })
  assert.ok(out.startsWith('translated:'))
}

console.log('PASS: instance-language translator usage')
