import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatOpenRouterError, OpenRouterClient } from '../../../utility/openrouter-client.js'
import { SlidingWindowRateLimiter } from '../../../utility/sliding-window-rate-limiter.js'

const RHYME_SYSTEM_PROMPT =
  'You are a poetic assistant. Given a word, list 5-8 words that rhyme with it, ' +
  'then write a short rhyming couplet (2 lines) that uses at least two of those words. ' +
  'Format your response as:\nRhymes: word1, word2, word3, ...\nCouplet:\n<line 1>\n<line 2>'

const rateLimiter = new SlidingWindowRateLimiter([
  { windowMs: 60_000, maxRequests: 3 },
  { windowMs: 300_000, maxRequests: 10 }
])

export default class Rhyme extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Fun',
      triggers: ['rhyme'],
      description: 'Finds rhyming words and generates a short couplet using AI',
      example: 'rhyme hello'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const word = context.args.at(0)
    if (word === undefined) {
      return `Usage: ${context.commandPrefix}rhyme <word>`
    }

    const senderId =
      context.message.user.discordProfile()?.id ??
      context.message.user.mojangProfile()?.id ??
      context.message.user.displayName()

    const rateCheck = rateLimiter.check(senderId)
    if (!rateCheck.allowed) {
      const seconds = Math.ceil(rateCheck.retryAfterMs / 1000)
      return `${context.username}, you are using this command too fast. Please wait ${seconds} second(s).`
    }

    const apiKey = context.app.openrouterApiKey
    if (!apiKey) {
      return 'OpenRouter API key is not configured. Set `openrouterApiKey` in config.yaml.'
    }

    const model = context.app.openrouterModel ?? 'nvidia/nemotron-3-nano-30b-a3b:free'
    const client = new OpenRouterClient(apiKey, { defaultModel: model })

    try {
      const result = await client.chatCompletion({
        systemPrompt: RHYME_SYSTEM_PROMPT,
        userPrompt: `Word: ${word}`,
        temperature: 0.7,
        reasoningEffort: 'low'
      })

      return result.content
    } catch (error: unknown) {
      return formatOpenRouterError(error, 'Rhyme', context.logger)
    }
  }
}
