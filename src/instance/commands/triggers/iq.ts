/*
 CREDIT: Idea by Aura
 Discord: Aura#5051
 Minecraft username: _aura
*/

import axios, { isAxiosError } from 'axios'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

const REQUEST_TIMEOUT_MS = 30_000

const rateLimitWindows = [
  { window: 60_000, max: 2 },
  { window: 300_000, max: 5 }
]
const userTimestamps = new Map<string, number[]>()

const CLEANUP_INTERVAL_MS = 300_000
const MAX_WINDOW_MS = 300_000
setInterval(() => {
  const cutoff = Date.now() - MAX_WINDOW_MS
  for (const [key, timestamps] of userTimestamps) {
    const recent = timestamps.filter((t) => t > cutoff)
    if (recent.length === 0) {
      userTimestamps.delete(key)
    } else {
      userTimestamps.set(key, recent)
    }
  }
}, CLEANUP_INTERVAL_MS).unref()

function checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const timestamps = userTimestamps.get(key) ?? []
  let maxRetry = 0
  for (const { window, max } of rateLimitWindows) {
    const recent = timestamps.filter((t) => now - t < window)
    if (recent.length >= max) {
      const retry = window - (now - recent[0])
      if (retry > maxRetry) maxRetry = retry
    }
  }
  if (maxRetry > 0) {
    return { allowed: false, retryAfterMs: maxRetry }
  }
  const cleaned = timestamps.filter((t) => now - t < 300_000)
  cleaned.push(now)
  userTimestamps.set(key, cleaned)
  return { allowed: true, retryAfterMs: 0 }
}

async function estimateIq(apiKey: string, model: string, username: string, messages: string[]): Promise<number> {
  const systemContent =
    'You are evaluating intelligence based on chat messages from a Hypixel Minecraft guild. ' +
    'Consider: vocabulary range, grammar, logical reasoning, game knowledge depth, humor, and critical thinking. ' +
    'Note: gaming abbreviations ("idk", "lol", "u") and Minecraft shorthand ("f7", "hyperion", "mana") are normal for this context — do NOT penalize for them. ' +
    'Estimate an IQ (0-200) based on the substance of what they are saying, not just surface formatting. ' +
    'Respond with ONLY the number, nothing else.'

  const userContent = `Chat messages from ${username}:\n${messages.join('\n')}`

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ],
      temperature: 0,
      reasoning: { effort: 'minimal' }
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT_MS
    }
  )

  const content: unknown = response.data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('Invalid API response: missing or empty content')
  }

  const parsed = Number.parseInt(content.trim(), 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid IQ value from API: "${content}"`)
  }
  return Math.max(0, Math.min(200, parsed))
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

    const userId =
      context.message.user.discordProfile()?.id ??
      context.message.user.mojangProfile()?.id ??
      context.message.user.displayName()

    const rateCheck = checkRateLimit(userId)
    if (!rateCheck.allowed) {
      const seconds = Math.ceil(rateCheck.retryAfterMs / 1000)
      return `${context.username}, you are using this command too fast. Please wait ${seconds} second(s).`
    }

    const chatMessages = context.app.core.chatMessages

    const cachedIq = await chatMessages.getCachedIq(userId)
    if (cachedIq !== undefined) {
      return `${givenUsername} has an IQ of ${cachedIq}`
    }

    const messages = await chatMessages.getMessages(userId)
    if (messages.length < 10) {
      return `${givenUsername}, not enough chat messages to estimate IQ (need at least 10).`
    }

    const apiKey = context.app.openrouterApiKey
    if (!apiKey) {
      return 'OpenRouter API key is not configured. Set `openrouterApiKey` in config.yaml.'
    }

    const model = context.app.openrouterModel ?? 'nvidia/nemotron-3-nano-30b-a3b:free'

    try {
      const iq = await estimateIq(apiKey, model, givenUsername, messages)
      await chatMessages.setCachedIq(userId, iq)
      return `${givenUsername} has an IQ of ${iq}`
    } catch (error: unknown) {
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
}
