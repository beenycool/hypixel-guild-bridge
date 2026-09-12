import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatOpenRouterError, OpenRouterClient } from '../../../utility/openrouter-client.js'

const defaultModel = 'nvidia/nemotron-3-super-120b-a12b:free'
const minMessages = 10
const prompt =
  'Estimate the user IQ (0 to 200) based on their Minecraft guild chat messages. ' +
  'Consider vocabulary, context, game knowledge and humor. Normal gaming slang (idk, f7, mana) is fine. ' +
  'Return ONLY the number.'

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

    const chatMessages = context.app.core.chatMessages
    const targetKey = givenUsername.toLowerCase()
    const bridgeId = context.message.bridgeId
    if (bridgeId === undefined) {
      return 'IQ estimation is not available: this message is not associated with a bridge.'
    }

    const cachedIq = await chatMessages.getCachedIq(bridgeId, targetKey)
    if (cachedIq !== undefined) {
      return `${givenUsername} has an IQ of ${cachedIq}`
    }

    const messages = isLookupSelf
      ? await chatMessages.getMessages(senderId, bridgeId)
      : await chatMessages.getMessagesByUsername(givenUsername, bridgeId)

    if (messages.length < minMessages) {
      return `${givenUsername}, not enough chat messages to estimate IQ (need at least ${minMessages}).`
    }

    const apiKey = context.app.openrouterApiKey
    if (!apiKey) {
      return 'OpenRouter API key is not configured. Set `openrouterApiKey` in config.yaml.'
    }

    const model = context.app.openrouterModel ?? defaultModel
    const client = new OpenRouterClient(apiKey, { defaultModel: model })

    try {
      const result = await client.chatCompletion({
        systemPrompt: prompt,
        userPrompt: `Chat messages from ${givenUsername}:\n${messages.join('\n')}`,
        reasoningEffort: 'high'
      })

      const parsed = Number.parseInt(result.content.trim(), 10)
      const iq = Number.isNaN(parsed) ? 100 : Math.max(0, Math.min(200, parsed))
      await chatMessages.setCachedIq(bridgeId, targetKey, iq)
      return `${givenUsername} has an IQ of ${iq}`
    } catch (error: unknown) {
      return formatOpenRouterError(error, 'IQ estimation', context.logger)
    }
  }
}
