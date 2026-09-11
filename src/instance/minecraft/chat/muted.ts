import { Color, MinecraftReactiveEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const MUTE_EXPIRE_REGEX = /^Your mute will expire in/

let lastWarning = 0

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = MUTE_EXPIRE_REGEX.exec(context.message)
    if (match != undefined && lastWarning + 300_000 < Date.now()) {
      const t = context.application.getTranslatorForBridge(context.clientInstance.bridgeId)
      const originEventId = context.clientInstance.getLastEventIdForSentChatMessage()
      if (originEventId === undefined) {
        context.logger.warn('No originEventId detected. Dropping the event')
        return
      }
      await context.application.emit('minecraftChatEvent', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Bad,
        type: MinecraftReactiveEventType.Muted,
        originEventId: originEventId,
        message: t('instance.reaction.muted', { hypixelMessage: context.message }),
        rawMessage: context.rawMessage
      })
      lastWarning = Date.now()
    }
  }
} satisfies MinecraftChatMessage
