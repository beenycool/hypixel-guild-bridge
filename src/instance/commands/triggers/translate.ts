import { isAxiosError } from 'axios'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { httpClient } from '../../../common/http.js'

const KNOWN_LANGUAGES = new Set([
  'english',
  'french',
  'spanish',
  'german',
  'italian',
  'portuguese',
  'russian',
  'chinese',
  'japanese',
  'korean',
  'arabic',
  'hindi',
  'dutch',
  'polish',
  'turkish',
  'vietnamese',
  'thai',
  'swedish',
  'danish',
  'norwegian',
  'finnish',
  'czech',
  'romanian',
  'hungarian',
  'ukrainian',
  'greek',
  'hebrew',
  'indonesian',
  'malay',
  'tagalog',
  'latin',
  'welsh',
  'irish',
  'icelandic',
  'swahili',
  'croatian',
  'serbian',
  'bulgarian',
  'slovak',
  'slovenian',
  'estonian',
  'latvian',
  'lithuanian',
  'galician',
  'catalan',
  'basque',
  'georgian',
  'armenian',
  'urdu',
  'persian',
  'tamil',
  'telugu',
  'kannada',
  'malayalam',
  'bengali',
  'punjabi',
  'marathi',
  'gujarati',
  'nepali',
  'sinhala',
  'khmer',
  'lao',
  'burmese',
  'mongolian',
  'amharic',
  'somali',
  'hausa',
  'yoruba',
  'zulu',
  'afrikaans',
  'albanian',
  'bosnian',
  'macedonian',
  'maltese',
  'luxembourgish',
  'azerbaijani',
  'kazakh',
  'uzbek',
  'turkmen',
  'kyrgyz',
  'tajik',
  'pashto',
  'kurdish',
  'sindhi'
])

const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_LENGTH = 240

export function parseTargetLanguage(argumentsList: string[]): { language: string | undefined; message: string } {
  if (argumentsList.length === 0) return { language: undefined, message: '' }

  if (argumentsList[0].toLowerCase() === 'to' && argumentsList.length > 1) {
    const candidate = argumentsList[1].toLowerCase()
    if (KNOWN_LANGUAGES.has(candidate)) {
      return { language: candidate, message: argumentsList.slice(2).join(' ') }
    }
  }

  const first = argumentsList[0].toLowerCase()
  if (KNOWN_LANGUAGES.has(first)) {
    return { language: first, message: argumentsList.slice(1).join(' ') }
  }

  return { language: undefined, message: argumentsList.join(' ') }
}

export default class Translate extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['translate', 'tr'],
      description: 'Translates text to a target language',
      example: 'translate %s french hello world'
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
        /* eslint-disable @typescript-eslint/naming-convention -- HTTP header names required by the OpenRouter API */
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        /* eslint-enable @typescript-eslint/naming-convention */
        timeout: REQUEST_TIMEOUT_MS
      }
    )

    const data = response.data as { choices?: { message?: { content?: unknown } }[] }
    const content: unknown = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('Invalid API response: missing or empty translation content')
    }

    return content
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const { args, commandPrefix } = context

    if (args.length === 0) {
      return `Usage: ${commandPrefix}translate [language] <message>`
    }

    const apiKey = context.app.openrouterApiKey
    if (!apiKey) {
      return 'OpenRouter API key is not configured. Set `openrouterApiKey` in config.yaml.'
    }

    const model = context.app.openrouterModel ?? 'nvidia/nemotron-3-nano-30b-a3b:free'
    const { language: targetLanguage, message } = parseTargetLanguage(args)

    if (message.length === 0) {
      return `Usage: ${commandPrefix}translate [language] <message>`
    }

    const systemContent =
      'You are a fast, direct translator. Prioritize speed. Do not overthink, analyze, or explain. Respond with ONLY the translated text, nothing else.'
    const userContent =
      targetLanguage === undefined
        ? `Translate the following text to English (auto-detect the source language): ${message}`
        : `Translate the following text to ${targetLanguage}: ${message}`

    try {
      const translatedText = await this.postToOpenRouter(apiKey, model, [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ])

      const maxLength = MAX_RESPONSE_LENGTH
      if (translatedText.length <= maxLength) {
        return `Translation: ${translatedText}`
      }

      const breakIndex = translatedText.lastIndexOf(' ', maxLength - 3)
      const truncateAt = breakIndex > 0 ? breakIndex : maxLength - 3
      return `Translation: ${translatedText.slice(0, truncateAt)}...`
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        context.logger.error(
          `Translate API error: status=${error.response?.status.toString() ?? 'unknown'}, ` +
            `message=${error.message}` +
            (error.response?.data ? `, data=${JSON.stringify(error.response.data)}` : '')
        )

        if (error.response?.status === 401) {
          return 'Translation failed: Invalid API key'
        }

        if (error.response?.status === 402) {
          return 'Translation failed: Insufficient credits'
        }

        if (error.response?.status === 429) {
          return 'Translation failed: Rate limited. Please try again later.'
        }

        if (error.code === 'ECONNABORTED') {
          return 'Translation failed: Request timed out. Please try again.'
        }

        const apiMessage: unknown = (error.response?.data as { error?: { message?: unknown } } | undefined)?.error
          ?.message
        const fallback = typeof apiMessage === 'string' ? apiMessage : error.message
        return `Translation failed: ${fallback}`
      }

      context.logger.error(error)
      return 'Translation failed: An unexpected error occurred'
    }
  }
}
