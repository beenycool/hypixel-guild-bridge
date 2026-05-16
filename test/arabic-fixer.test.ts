import assert from 'node:assert'
import { describe, it } from 'node:test'

import ArabicFixer from '../src/instance/minecraft/utility/arabic-fixer.js'

await describe('ArabicFixer', async () => {
  const fixer = new ArabicFixer()

  await it('passes non-Arabic text through unchanged', () => {
    assert.strictEqual(fixer.encode('hello world'), 'hello world')
  })

  await it('passes ASCII text with numbers through unchanged', () => {
    assert.strictEqual(fixer.encode('test 123'), 'test 123')
  })

  await it('passes empty string through unchanged', () => {
    assert.strictEqual(fixer.encode(''), '')
  })

  await it('processes Arabic text', () => {
    const result = fixer.encode('السلام عليكم')
    assert.ok(result.length > 0)
    assert.notStrictEqual(result, 'السلام عليكم')
  })

  await it('processes mixed Arabic and English text', () => {
    const result = fixer.encode('hello السلام')
    assert.ok(result.length > 0)
  })

  await it('processes Arabic with numbers', () => {
    const result = fixer.encode('اختبار 123')
    assert.ok(result.length > 0)
  })

  await it('handles Arabic text with punctuation', () => {
    const result = fixer.encode('مرحبا!')
    assert.ok(result.length > 0)
  })

  await it('passes other Unicode scripts through unchanged', () => {
    assert.strictEqual(fixer.encode('中文测试'), '中文测试')
    assert.strictEqual(fixer.encode('日本語'), '日本語')
  })

  await it('passes whitespace-only string through unchanged', () => {
    assert.strictEqual(fixer.encode('   '), '   ')
  })

  await it('processes Arabic containing Unicode formatting characters', () => {
    const result = fixer.encode('سلام\u200Cعليكم')
    assert.ok(result.length > 0)
  })
})
