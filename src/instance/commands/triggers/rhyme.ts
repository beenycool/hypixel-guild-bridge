import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { isAxiosError, OpenRouterClient } from '../../../utility/openrouter-client.js'
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
      triggers: ['rhyme'],
      description: 'Finds rhyming words and generates a short couplet using AI',
      example: 'rhyme hello'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const word = context.args[0]
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

    const model = context.app.openrouterModel
    const client = new OpenRouterClient(apiKey, { defaultModel: model })

    try {
      const result = await client.chatCompletion({
        systemPrompt: RHYME_SYSTEM_PROMPT,
        userPrompt: `Word: ${word}`,
        temperature: 0.7
      })

      return result.content
    } catch (error: unknown) {
      return this.handleError(context, error)
    }
  }

  private handleError(context: ChatCommandContext, error: unknown): string {
    if (isAxiosError(error)) {
      context.logger.error(
        `Rhyme API error: status=${error.response?.status?.toString() ?? 'unknown'}, ` +
          `message=${error.message}` +
          (error.response?.data ? `, data=${JSON.stringify(error.response.data)}` : '')
      )

      if (error.response?.status === 401) {
        return 'Rhyme failed: Invalid API key'
      }

      if (error.response?.status === 402) {
        return 'Rhyme failed: Insufficient credits'
      }

      if (error.response?.status === 429) {
        return 'Rhyme failed: Rate limited. Please try again later.'
      }

      if (error.code === 'ECONNABORTED') {
        return 'Rhyme failed: Request timed out. Please try again.'
      }

      const apiMessage: unknown = error.response?.data?.error?.message
      const fallback = typeof apiMessage === 'string' ? apiMessage : error.message
      return `Rhyme failed: ${fallback}`
    }

    context.logger.error(error)
    return 'Rhyme failed: An unexpected error occurred'
  }
}
