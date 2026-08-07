import assert from 'node:assert'
import { describe, it } from 'node:test'

import { LinksSanitizer } from '../src/instance/minecraft/utility/links-sanitizer.js'

const hideConfig = {
  getHideLinksViaStuf: () => false,
  getResolveHideLinks: () => false
} as unknown as ConstructorParameters<typeof LinksSanitizer>[0]

const resolveConfig = {
  getHideLinksViaStuf: () => false,
  getResolveHideLinks: () => true
} as unknown as ConstructorParameters<typeof LinksSanitizer>[0]

const fakeHttp = (contentType: string, description: string) => {
  const headers: Record<string, string> = { ['content-type']: contentType }
  return {
    head: () => Promise.resolve({ headers }),
    post: () => Promise.resolve({ data: { choices: [{ message: { content: description } }] } })
  } as unknown as ConstructorParameters<typeof LinksSanitizer>[2]
}

await describe('LinksSanitizer hideLink mode', async () => {
  const sanitizer = new LinksSanitizer(hideConfig, undefined)

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

await describe('LinksSanitizer resolveLinkHide mode', async () => {
  const apiKey = 'test-api-key'

  await it('describes an image as "sent an image: <description>"', async () => {
    const sanitizer = new LinksSanitizer(resolveConfig, apiKey, fakeHttp('image/png', 'A black puppy looking up.'))
    const result = await sanitizer.process('https://cdn.example.com/puppy.png')
    assert.strictEqual(result, 'sent an image: A black puppy looking up.')
  })

  await it('describes a video as "sent a video: <description>"', async () => {
    const sanitizer = new LinksSanitizer(resolveConfig, apiKey, fakeHttp('video/mp4', 'A park with trees.'))
    const result = await sanitizer.process('https://cdn.example.com/park.mp4')
    assert.strictEqual(result, 'sent a video: A park with trees.')
  })

  await it('truncates the description to the passed maxDescriptionLength', async () => {
    const sanitizer = new LinksSanitizer(
      resolveConfig,
      apiKey,
      fakeHttp('image/png', 'A park with trees and a path, with cars and a bus passing by.')
    )
    const result = await sanitizer.process('https://cdn.example.com/park.png', { maxDescriptionLength: 30 })
    assert.strictEqual(result, 'sent an image: A park with trees and a...')
  })

  await it('keeps descriptions within the default 80-character limit', async () => {
    const sanitizer = new LinksSanitizer(resolveConfig, apiKey, fakeHttp('image/png', 'A very long '.repeat(12)))
    const result = await sanitizer.process('https://cdn.example.com/long.png')
    assert.ok(result.startsWith('sent an image: '))
    assert.ok(result.endsWith('...'))
    assert.ok(result.length <= 'sent an image: '.length + 80)
  })

  await it('falls back to (image) without an api key', async () => {
    const sanitizer = new LinksSanitizer(resolveConfig, undefined, fakeHttp('image/png', 'ignored'))
    const result = await sanitizer.process('https://cdn.example.com/puppy.png')
    assert.strictEqual(result, '(image)')
  })

  await it('falls back to (link) for non-media content types', async () => {
    const sanitizer = new LinksSanitizer(resolveConfig, apiKey, fakeHttp('text/html', 'ignored'))
    const result = await sanitizer.process('https://example.com/page')
    assert.strictEqual(result, '(link)')
  })

  await it('falls back to (image) on empty model output', async () => {
    const sanitizer = new LinksSanitizer(resolveConfig, apiKey, fakeHttp('image/png', ''))
    const result = await sanitizer.process('https://cdn.example.com/blank.png')
    assert.strictEqual(result, '(image)')
  })

  await it('describes media mixed with regular text', async () => {
    const sanitizer = new LinksSanitizer(resolveConfig, apiKey, fakeHttp('image/png', 'A castle.'))
    const result = await sanitizer.process('look at https://cdn.example.com/castle.png')
    assert.strictEqual(result, 'look at sent an image: A castle.')
  })
})
