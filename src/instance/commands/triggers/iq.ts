/*
 CREDIT: Idea by Aura
 Discord: Aura#5051
 Minecraft username: _aura
*/

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { isAxiosError, OpenRouterClient } from '../../../utility/openrouter-client.js'
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
      triggers: ['iq'],
      description: "Returns a player's IQ (0-200)",
      example: 'iq %s'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const isLookupSelf =
      context.args[0] === undefined || context.args[0].toLowerCase() === context.username.toLowerCase()

    // Rate limit on the sender (not the target)
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

    // Cache and messages keyed on the target, not the sender
    const targetKey = givenUsername.toLowerCase()

    const cachedIq = await chatMessages.getCachedIq(targetKey)
    if (cachedIq !== undefined) {
      return `${givenUsername} has an IQ of ${cachedIq}`
    }

    // Fetch messages for the correct user
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
      return this.handleError(context, error)
    }
  }

  private handleError(context: ChatCommandContext, error: unknown): string {
    if (isAxiosError(error)) {
      context.logger.error(
        `IQ API error: status=${error.response?.status?.toString() ?? 'unknown'}, ` +
          `message=${error.message}` +
          (error.response?.data ? `, data=${JSON.stringify(error.response.data)}` : '')
      )

      if (error.response?.status === 401) {
        return 'IQ estimation failed: Invalid API key'
      }

      if (error.response?.status === 402) {
        return 'IQ estimation failed: Insufficient credits'
      }

      if (error.response?.status === 429) {
        return 'IQ estimation failed: Rate limited. Please try again later.'
      }

      if (error.code === 'ECONNABORTED') {
        return 'IQ estimation failed: Request timed out. Please try again.'
      }

      const apiMessage: unknown = error.response?.data?.error?.message
      const fallback = typeof apiMessage === 'string' ? apiMessage : error.message
      return `IQ estimation failed: ${fallback}`
    }

    context.logger.error(error)
    return 'IQ estimation failed: An unexpected error occurred'
  }
}
