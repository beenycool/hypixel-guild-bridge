import assert from 'node:assert'
import { describe, it } from 'node:test'

import DotsSanitizer from '../src/instance/minecraft/utility/dot-sanitizer.js'

await describe('DotsSanitizer', async () => {
  const sanitizer = new DotsSanitizer()

  await it('keeps decimal points in numbers', () => {
    assert.strictEqual(sanitizer.process('9.78k'), '9.78k')
    assert.strictEqual(sanitizer.process('WLR: 2.77'), 'WLR: 2.77')
    assert.strictEqual(sanitizer.process('1.5'), '1.5')
    assert.strictEqual(sanitizer.process('patch 1.0'), 'patch 1.0')
  })

  await it('strips dots in words', () => {
    assert.strictEqual(sanitizer.process('hello.world'), 'helloworld')
    assert.strictEqual(sanitizer.process('Mr. John'), 'Mr John')
    assert.strictEqual(sanitizer.process('gg.wp'), 'ggwp')
  })

  await it('strips sequences of dots', () => {
    assert.strictEqual(sanitizer.process('...'), '')
  })

  await it('keeps decimal points in mixed content', () => {
    assert.strictEqual(sanitizer.process('W: 9.78k | gg.wp'), 'W: 9.78k | ggwp')
  })

  await it('handles empty string', () => {
    assert.strictEqual(sanitizer.process(''), '')
  })

  await it('passes plain text through unchanged', () => {
    assert.strictEqual(sanitizer.process('hello world'), 'hello world')
  })
})
