import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatOpenRouterError, OpenRouterClient } from '../../../utility/openrouter-client.js'

const languages = new Set([
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
  'tagalog'
])

function parseTargetLanguage(argumentsList: string[]): { language: string | undefined; message: string } {
  if (argumentsList.length === 0) return { language: undefined, message: '' }

  if (argumentsList[0].toLowerCase() === 'to' && argumentsList.length > 1) {
    const candidate = argumentsList[1].toLowerCase()
    if (languages.has(candidate)) {
      return { language: candidate, message: argumentsList.slice(2).join(' ') }
    }
  }

  const first = argumentsList[0].toLowerCase()
  if (languages.has(first)) {
    return { language: first, message: argumentsList.slice(1).join(' ') }
  }

  return { language: undefined, message: argumentsList.join(' ') }
}

export default class Translate extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Utility',
      triggers: ['translate', 'tr'],
      description: 'Translates text to a target language',
      example: 'translate %s french hello world'
    })
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

    const model = context.app.openrouterModel ?? 'nvidia/nemotron-3.5-lightning:free'
    const { language: targetLanguage, message } = parseTargetLanguage(args)

    if (message.length === 0) {
      return `Usage: ${commandPrefix}translate [language] <message>`
    }

    const userContent =
      targetLanguage === undefined
        ? `Translate the following text to English (auto-detect the source language): ${message}`
        : `Translate the following text to ${targetLanguage}: ${message}`

    const client = new OpenRouterClient(apiKey, { defaultModel: model })

    try {
      const result = await client.chatCompletion({
        systemPrompt: 'Translate text directly. Respond with ONLY the translated text.',
        userPrompt: userContent,
        temperature: 0.3,
        reasoningEffort: 'low'
      })

      const translated = result.content
      if (translated.length <= 240) {
        return `Translation: ${translated}`
      }

      const breakIndex = translated.lastIndexOf(' ', 237)
      const truncateAt = breakIndex === -1 ? 237 : breakIndex
      return `Translation: ${translated.slice(0, truncateAt)}...`
    } catch (error: unknown) {
      return formatOpenRouterError(error, 'Translation', context.logger)
    }
  }
}
