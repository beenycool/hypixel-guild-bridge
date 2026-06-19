import axios, { isAxiosError } from 'axios'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Translate extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['translate', 'tr'],
      description: 'Translates text to a target language',
      example: 'translate %s french hello world'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const { args } = context
    if (args.length === 0) {
      return 'Usage: !translate [language] <message>'
    }

    const language = args.length === 1 ? 'english' : args[0]
    const text = args.length === 1 ? args[0] : args.slice(1).join(' ')

    const apiKey = context.app.openrouterApiKey
    if (!apiKey) {
      return 'OpenRouter API key is not configured. Set `openrouterApiKey` in config.yaml.'
    }

    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'nvidia/nemotron-3-nano-30b-a3b:free',
          messages: [
            {
              role: 'system',
              content: `You are a translator. Translate the user's message to ${language}. Detect the source language automatically. Respond with ONLY the translated text, nothing else.`
            },
            {
              role: 'user',
              content: text
            }
          ],
          temperature: 0.3,
          reasoning: { effort: 'low' }
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      )

      const translatedText: string = response.data.choices[0].message.content
      const truncated = translatedText.length > 250 ? translatedText.slice(0, 247) + '...' : translatedText
      return `Translation (${language}): ${truncated}`
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        if (error.response?.status === 401) {
          return 'Translation failed: Invalid API key'
        }
        if (error.response?.status === 402) {
          return 'Translation failed: Insufficient credits'
        }
        const message = error.response?.data?.error?.message ?? error.message
        return `Translation failed: ${message}`
      }
      context.logger.error(error)
      return 'Translation failed: An unexpected error occurred'
    }
  }
}
