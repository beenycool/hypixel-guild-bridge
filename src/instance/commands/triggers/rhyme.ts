import { isAxiosError } from 'axios'

import { httpClient } from '../../../common/http.js'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_LENGTH = 240

export default class Rhyme extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['rhyme'],
      description: 'Finds rhyming words',
      example: 'rhyme %s hello'
    })
  }

  protected async postToOpenRouter(
    apiKey: string,
    model: string,
    messages: { role: string; content: string }[]
  ): Promise<string> {
    const response = await httpClient.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages,
        temperature: 0.3,
        reasoning: { effort: 'low' }
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
      throw new Error('Invalid API response: missing or empty rhyme content')
    }

    return content
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const { args, commandPrefix } = context

    if (args.length === 0) {
      return `Usage: ${commandPrefix}rhyme <word> [count]`
    }

    const apiKey = context.app.openrouterApiKey
    if (!apiKey) {
      return 'OpenRouter API key is not configured. Set `openrouterApiKey` in config.yaml.'
    }

    const model = context.app.openrouterModel ?? 'nvidia/nemotron-3-nano-30b-a3b:free'

    let word: string
    let count: number | undefined

    const lastArg = args[args.length - 1]
    const parsedCount = Number(lastArg)
    if (args.length > 1 && Number.isInteger(parsedCount) && parsedCount > 0) {
      count = parsedCount
      word = args.slice(0, -1).join(' ')
    } else {
      word = args.join(' ')
    }

    const countInstruction =
      count !== undefined
        ? `Provide exactly ${count} rhyming words, one per line.`
        : 'Provide exactly one rhyming word.'

    const systemContent = 'You are a rhyming assistant. Respond with ONLY rhyming words, one per line, nothing else.'
    const userContent = `Find a word that rhymes with "${word}". ${countInstruction} Respond with ONLY the rhyming word(s), nothing else.`

    try {
      const rhymeText = await this.postToOpenRouter(apiKey, model, [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ])

      const maxLength = MAX_RESPONSE_LENGTH
      if (rhymeText.length <= maxLength) {
        return `Rhymes with "${word}": ${rhymeText}`
      }

      const breakIndex = rhymeText.lastIndexOf(' ', maxLength - 3)
      const truncateAt = breakIndex > 0 ? breakIndex : maxLength - 3
      return `Rhymes with "${word}": ${rhymeText.slice(0, truncateAt)}...`
    } catch (error: unknown) {
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
}
