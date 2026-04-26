import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Aimute extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['aimute'],
      description: 'Mute/unmute AI chat for this bridge',
      example: 'aimute'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const aiChatStorage = context.app.core.aiChatStorage
    const bridgeId = context.message.bridgeId
    const isMuted = await aiChatStorage.isBridgeMuted(bridgeId)
    await aiChatStorage.setBridgeMuted(bridgeId, !isMuted)

    if (isMuted) {
      return `${context.username}, AI chat has been unmuted for this bridge.`
    }
    return `${context.username}, AI chat has been muted for this bridge.`
  }
}
