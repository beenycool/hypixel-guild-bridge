import assert from 'node:assert'

export function getUuidFromGuildChat(message: unknown): string {
  const clickCommand = (message as { extra: { clickEvent: { value: string } }[] }).extra[0].clickEvent.value

  const uuidWithDashes = clickCommand.split(' ')[1].trim()
  const uuid = uuidWithDashes.replaceAll('-', '')
  assert.ok(uuid.length === 32, `Invalid uuid. given: ${uuid}`)

  return uuid
}
