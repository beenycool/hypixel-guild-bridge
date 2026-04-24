import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { APIEmbed } from 'discord.js'

import { splitToEmbeds } from '../src/instance/discord/utility/embed-utilities.js'

await describe('splitToEmbeds', async () => {
  await it('splits long text into pages under the max length and preserves content', () => {
    const lines: string[] = []
    for (let index = 0; index < 500; index++) {
      lines.push(`Line ${index} - some content that ensures the text gets long enough.`)
    }

    const text = lines.join('\n')
    const base: APIEmbed = { title: 'test', description: '' }

    const pages = splitToEmbeds(base, text, 1000)

    assert.ok(pages.length > 1)
    for (const p of pages) {
      assert.ok(p.description !== undefined)
      assert.ok(p.description.length <= 1000)
    }

    const reconstructed = pages
      .map((p) => {
        const description = p.description
        return description === undefined ? '' : description.trim()
      })
      .join('\n')
      .trim()
    assert.strictEqual(reconstructed, text.trim())
  })
})
