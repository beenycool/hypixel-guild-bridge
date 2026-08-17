import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatOpenRouterError, OpenRouterClient } from '../../../utility/openrouter-client.js'
import { SlidingWindowRateLimiter } from '../../../utility/sliding-window-rate-limiter.js'

import { IQ_DEFAULT_MODEL, IQ_MAX, IQ_MIN, IQ_MIN_MESSAGES, IQ_SYSTEM_PROMPT } from './iq-constants.js'

const rateLimiter = new SlidingWindowRateLimiter([
  { windowMs: 60_000, maxRequests: 2 },
  { windowMs: 300_000, maxRequests: 5 }
])

function parseIqScore(content: string): number {
  const parsed = Number.parseInt(content.trim(), 10)
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Invalid IQ value from API: "${content}"`)
  }
  return Math.max(IQ_MIN, Math.min(IQ_MAX, parsed))
}

export default class Iq extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Fun',
      triggers: ['iq'],
      description: "Returns a player's IQ (0-200)",
      example: 'iq %s'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const firstArgument = context.args.at(0)
    const givenUsername = firstArgument ?? context.username
    const isLookupSelf = firstArgument === undefined || firstArgument.toLowerCase() === context.username.toLowerCase()

    const senderId =
      context.message.user.discordProfile()?.id ??
      context.message.user.mojangProfile()?.id ??
      context.message.user.displayName()

    const rateCheck = rateLimiter.check(senderId)
    if (!rateCheck.allowed) {
      const seconds = Math.ceil(rateCheck.retryAfterMs / 1000)
      return `${context.username}, you are using this command too fast. Please wait ${seconds} second(s).`
    }

    const chatMessages = context.app.core.chatMessages

    const targetKey = givenUsername.toLowerCase()

    const cachedIq = await chatMessages.getCachedIq(targetKey)
    if (cachedIq !== undefined) {
      return `${givenUsername} has an IQ of ${cachedIq}`
    }

    const messages = isLookupSelf
      ? await chatMessages.getMessages(senderId)
      : await chatMessages.getMessagesByUsername(givenUsername)

    if (messages.length < IQ_MIN_MESSAGES) {
      return `${givenUsername}, not enough chat messages to estimate IQ (need at least ${IQ_MIN_MESSAGES}).`
    }

    const apiKey = context.app.openrouterApiKey
    if (!apiKey) {
      return 'OpenRouter API key is not configured. Set `openrouterApiKey` in config.yaml.'
    }

    const model = context.app.openrouterModel ?? IQ_DEFAULT_MODEL
    const client = new OpenRouterClient(apiKey, { defaultModel: model })

    try {
      const result = await client.chatCompletion({
        systemPrompt: IQ_SYSTEM_PROMPT,
        userPrompt: `Chat messages from ${givenUsername}:\n${messages.join('\n')}`,
        reasoningEffort: 'high'
      })

      const iq = parseIqScore(result.content)
      await chatMessages.setCachedIq(targetKey, iq)
      return `${givenUsername} has an IQ of ${iq}`
    } catch (error: unknown) {
      return formatOpenRouterError(error, 'IQ estimation', context.logger)
    }
  }
}
