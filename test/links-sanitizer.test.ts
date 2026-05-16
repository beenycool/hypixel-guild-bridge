import assert from 'node:assert'
import { describe, it } from 'node:test'

import { LinksSanitizer } from '../src/instance/minecraft/utility/links-sanitizer.js'

const hideConfig = {
  getHideLinksViaStuf: () => false,
  getResolveHideLinks: () => false
} as unknown as ConstructorParameters<typeof LinksSanitizer>[0]

await describe('LinksSanitizer hideLink mode', async () => {
  const sanitizer = new LinksSanitizer(hideConfig)

  await it('replaces https URL with (link)', async () => {
    const result = await sanitizer.process('check https://example.com')
    assert.strictEqual(result, 'check (link)')
  })

  await it('replaces http URL with (link)', async () => {
    const result = await sanitizer.process('visit http://example.com')
    assert.strictEqual(result, 'visit (link)')
  })

  await it('replaces multiple URLs', async () => {
    const result = await sanitizer.process('https://a.com and http://b.com')
    assert.strictEqual(result, '(link) and (link)')
  })

  await it('replaces URL with path/query', async () => {
    const result = await sanitizer.process('go to https://example.com/path?q=1')
    assert.strictEqual(result, 'go to (link)')
  })

  await it('passes plain text without URLs through unchanged', async () => {
    const result = await sanitizer.process('hello world')
    assert.strictEqual(result, 'hello world')
  })

  await it('passes non-http protocols through unchanged', async () => {
    const result = await sanitizer.process('ftp://example.com')
    assert.strictEqual(result, 'ftp://example.com')
  })

  await it('handles empty string', async () => {
    const result = await sanitizer.process('')
    assert.strictEqual(result, '')
  })

  await it('handles text with trailing punctuation', async () => {
    const result = await sanitizer.process('check https://example.com.')
    assert.strictEqual(result, 'check (link).')
  })

  await it('preserves non-URL words when URL is present', async () => {
    const result = await sanitizer.process('hello https://x.com world')
    assert.strictEqual(result, 'hello (link) world')
  })
})
