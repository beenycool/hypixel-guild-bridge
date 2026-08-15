import assert from 'node:assert'
import { describe, it } from 'node:test'

import { AxiosError } from 'axios'

import type { ChatCommandContext } from '../src/common/commands.js'
import Translate, { parseTargetLanguage } from '../src/instance/commands/triggers/translate.js'

function makeMockContext(
  overrides: Partial<ChatCommandContext> & { appOverrides?: Record<string, unknown> } = {}
): ChatCommandContext {
  const appOverrides = overrides.appOverrides ?? {}

  return {
    app: {
      openrouterApiKey: 'test-api-key',
      openrouterModel: undefined,
      logger: {
        error: () => {}
      },
      ...appOverrides
    },
    commandPrefix: '!',
    args: [],
    username: 'TestUser',
    eventHelper: {} as ChatCommandContext['eventHelper'],
    logger: {
      error: () => {}
    } as unknown as ChatCommandContext['logger'],
    errorHandler: {} as ChatCommandContext['errorHandler'],
    allCommands: [],
    message: {} as ChatCommandContext['message'],
    sendFeedback: () => Promise.resolve(),
    ...overrides
  } as unknown as ChatCommandContext
}

type MockImpl = (apiKey: string, model: string, messages: { role: string; content: string }[]) => Promise<string>

class TestTranslate extends Translate {
  mockImpl: MockImpl | undefined = undefined

  protected override async postToOpenRouter(
    apiKey: string,
    model: string,
    messages: { role: string; content: string }[]
  ): Promise<string> {
    if (this.mockImpl) return this.mockImpl(apiKey, model, messages)
    throw new Error('No mockImpl set — use mockImpl to control behavior')
  }
}

async function assertHandlerResult(
  command: TestTranslate,
  context: ChatCommandContext,
  expected: string | RegExp
): Promise<void> {
  const result = await command.handler(context)
  if (typeof expected === 'string') {
    assert.strictEqual(result, expected)
  } else {
    assert.match(result, expected)
  }
}

await describe('parseTargetLanguage', async () => {
  await it('returns empty message for empty args', () => {
    const result = parseTargetLanguage([])
    assert.strictEqual(result.language, undefined)
    assert.strictEqual(result.message, '')
  })

  await it('detects known language as first arg', () => {
    const result = parseTargetLanguage(['french', 'hello', 'world'])
    assert.strictEqual(result.language, 'french')
    assert.strictEqual(result.message, 'hello world')
  })

  await it('is case-insensitive for language detection', () => {
    const result = parseTargetLanguage(['French', 'bonjour'])
    assert.strictEqual(result.language, 'french')
    assert.strictEqual(result.message, 'bonjour')
  })

  await it('returns no language for unknown first arg', () => {
    const result = parseTargetLanguage(['hello', 'world'])
    assert.strictEqual(result.language, undefined)
    assert.strictEqual(result.message, 'hello world')
  })

  await it('handles single-arg known language (no message)', () => {
    const result = parseTargetLanguage(['german'])
    assert.strictEqual(result.language, 'german')
    assert.strictEqual(result.message, '')
  })

  await it('handles single-arg unknown word (no language, that word is the message)', () => {
    const result = parseTargetLanguage(['hello'])
    assert.strictEqual(result.language, undefined)
    assert.strictEqual(result.message, 'hello')
  })

  await it('detects many known languages', () => {
    const languages = ['english', 'spanish', 'japanese', 'arabic', 'russian', 'hebrew', 'swahili', 'icelandic']
    for (const lang of languages) {
      const result = parseTargetLanguage([lang, 'some text'])
      assert.strictEqual(result.language, lang, `failed for language: ${lang}`)
    }
  })

  await it('preserves original arg for language (lowercased)', () => {
    const result = parseTargetLanguage(['FRENCH', 'bonjour'])
    assert.strictEqual(result.language, 'french')
    assert.strictEqual(result.message, 'bonjour')
  })

  await it('detects known language with optional "to" prefix', () => {
    const result = parseTargetLanguage(['to', 'french', 'hello', 'world'])
    assert.strictEqual(result.language, 'french')
    assert.strictEqual(result.message, 'hello world')
  })

  await it('is case-insensitive with "to" prefix', () => {
    const result = parseTargetLanguage(['to', 'Spanish', 'hola'])
    assert.strictEqual(result.language, 'spanish')
    assert.strictEqual(result.message, 'hola')
  })

  await it('handles "to" prefix when second word is not a known language', () => {
    const result = parseTargetLanguage(['to', 'be', 'or', 'not', 'to', 'be'])
    assert.strictEqual(result.language, undefined)
    assert.strictEqual(result.message, 'to be or not to be')
  })
})

await describe('Translate command handler', async () => {
  await it('returns usage when no args provided', async () => {
    const command = new TestTranslate()
    const context = makeMockContext({ commandPrefix: '!' })
    await assertHandlerResult(command, context, 'Usage: !translate [language] <message>')
  })

  await it('uses custom command prefix in usage', async () => {
    const command = new TestTranslate()
    const context = makeMockContext({ commandPrefix: '?' })
    await assertHandlerResult(command, context, 'Usage: ?translate [language] <message>')
  })

  await it('returns missing API key message when key is not set', async () => {
    const command = new TestTranslate()
    const context = makeMockContext({
      appOverrides: { openrouterApiKey: undefined }
    })
    context.args = ['hello']
    await assertHandlerResult(command, context, /OpenRouter API key is not configured/)
  })

  await it('returns usage when only a language is given (no message)', async () => {
    const command = new TestTranslate()
    const context = makeMockContext({ commandPrefix: '!' })
    context.args = ['french']
    await assertHandlerResult(command, context, 'Usage: !translate [language] <message>')
  })

  await it('translates with explicit language', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => Promise.resolve('Bonjour le monde')
    const context = makeMockContext()
    context.args = ['french', 'hello']
    const result = await command.handler(context)
    assert.strictEqual(result, 'Translation: Bonjour le monde')
  })

  await it('translates without explicit language (auto-detect)', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => Promise.resolve('Hello world')
    const context = makeMockContext()
    context.args = ['bonjour le monde']
    const result = await command.handler(context)
    assert.strictEqual(result, 'Translation: Hello world')
  })

  await it('returns 401 error message', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => {
      throw Object.assign(new AxiosError('Unauthorized', 'ERR_BAD_REQUEST'), {
        response: { status: 401, data: {} }
      })
    }
    const context = makeMockContext()
    context.args = ['hello']
    await assertHandlerResult(command, context, 'Translation failed: Invalid API key')
  })

  await it('returns 402 error message', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => {
      throw Object.assign(new AxiosError('Payment Required', 'ERR_BAD_REQUEST'), {
        response: { status: 402, data: {} }
      })
    }
    const context = makeMockContext()
    context.args = ['hello']
    await assertHandlerResult(command, context, 'Translation failed: Insufficient credits')
  })

  await it('returns 429 rate limit message', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => {
      throw Object.assign(new AxiosError('Too Many Requests', 'ERR_BAD_REQUEST'), {
        response: { status: 429, data: {} }
      })
    }
    const context = makeMockContext()
    context.args = ['hello']
    await assertHandlerResult(command, context, /Translation failed: Rate limited/)
  })

  await it('returns timeout message on ECONNABORTED', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => {
      throw Object.assign(new AxiosError('timeout', 'ECONNABORTED'), {
        code: 'ECONNABORTED',
        response: undefined
      })
    }
    const context = makeMockContext()
    context.args = ['hello']
    await assertHandlerResult(command, context, /Translation failed: Request timed out/)
  })

  await it('returns generic axios error with message from API', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => {
      throw Object.assign(new AxiosError('Bad Request', 'ERR_BAD_REQUEST'), {
        response: {
          status: 400,
          data: { error: { message: 'Model not available' } }
        }
      })
    }
    const context = makeMockContext()
    context.args = ['hello']
    await assertHandlerResult(command, context, 'Translation failed: Model not available')
  })

  await it('handles non-axios errors with generic message', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => {
      throw new Error('Something went horribly wrong')
    }
    const context = makeMockContext()
    context.args = ['hello']
    await assertHandlerResult(command, context, 'Translation failed: An unexpected error occurred')
  })

  await it('handles malformed API response (missing content)', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => {
      throw new Error('Invalid API response: missing or empty translation content')
    }
    const context = makeMockContext()
    context.args = ['hello']
    await assertHandlerResult(command, context, 'Translation failed: An unexpected error occurred')
  })

  await it('uses configurable model when set', async () => {
    let capturedModel = ''
    const command = new TestTranslate()
    command.mockImpl = (apiKey, model) => {
      void apiKey
      capturedModel = model
      return Promise.resolve('translated')
    }
    const context = makeMockContext({
      appOverrides: { openrouterModel: 'custom-model' }
    })
    context.args = ['hello']
    await command.handler(context)
    assert.strictEqual(capturedModel, 'custom-model')
  })

  await it('uses default model when not configured', async () => {
    let capturedModel = ''
    const command = new TestTranslate()
    command.mockImpl = (apiKey, model) => {
      void apiKey
      capturedModel = model
      return Promise.resolve('translated')
    }
    const context = makeMockContext()
    context.args = ['hello']
    await command.handler(context)
    assert.strictEqual(capturedModel, 'nvidia/nemotron-3-nano-30b-a3b:free')
  })

  await it('truncates long translations at word boundary', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => Promise.resolve('a'.repeat(100) + ' ' + 'b'.repeat(200))
    const context = makeMockContext()
    context.args = ['hello']
    const result = await command.handler(context)
    assert.ok(result.endsWith('...'))
    assert.ok(result.length <= 256)
    assert.ok(!result.includes('bbbbbbb...'))
  })

  await it('truncates long translations with no spaces', async () => {
    const command = new TestTranslate()
    command.mockImpl = () => Promise.resolve('a'.repeat(300))
    const context = makeMockContext()
    context.args = ['hello']
    const result = await command.handler(context)
    assert.ok(result.endsWith('...'))
    assert.ok(result.length <= 256)
  })

  await it('does not truncate short translations', async () => {
    const command = new TestTranslate()
    const shortText = 'Hello, how are you?'
    command.mockImpl = () => Promise.resolve(shortText)
    const context = makeMockContext()
    context.args = ['french', shortText]
    const result = await command.handler(context)
    assert.strictEqual(result, `Translation: ${shortText}`)
  })
})
