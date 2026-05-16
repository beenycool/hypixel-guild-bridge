import assert from 'node:assert'
import { describe, it } from 'node:test'

import EmojiSanitizer from '../src/instance/minecraft/utility/emoji-sanitizer.js'

await describe('EmojiSanitizer', async () => {
  const sanitizer = new EmojiSanitizer()

  await it('substitutes heart variant (❤️ → ❤)', () => {
    assert.strictEqual(sanitizer.process('❤️'), '❤')
  })

  await it('substitutes skull variant (☠️ → ☠)', () => {
    assert.strictEqual(sanitizer.process('☠️'), '☠')
  })

  await it('substitutes heart with surrounding text', () => {
    assert.strictEqual(sanitizer.process('I ❤️ you'), 'I ❤ you')
  })

  await it('converts non-allowed emoji to :name: format', () => {
    const result = sanitizer.process('😀')
    assert.ok(result.includes(':grinning:'))
  })

  await it('passes plain text through unchanged', () => {
    assert.strictEqual(sanitizer.process('hello world'), 'hello world')
  })

  await it('passes allowed emoji through unchanged', () => {
    assert.strictEqual(sanitizer.process('☺'), '☺')
    assert.strictEqual(sanitizer.process('❤'), '❤')
  })

  await it('handles empty string', () => {
    assert.strictEqual(sanitizer.process(''), '')
  })

  await it('handles mixed content with allowed and non-allowed emoji', () => {
    const result = sanitizer.process('☺ and 😀')
    assert.ok(result.includes('☺'))
    assert.ok(result.includes(':grinning:'))
  })

  await it('handles multiple identical substitutions', () => {
    assert.strictEqual(sanitizer.process('💚 💙'), '❤ ❤')
  })

  await it('handles string with only colons', () => {
    assert.strictEqual(sanitizer.process(':::'), ':::')
  })
})
