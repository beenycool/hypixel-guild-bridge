import { Color, MinecraftReactiveEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const ADVERTISE_REGEX = /^Advertising is against the rules\. You will receive a punishment on the server/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = ADVERTISE_REGEX.exec(context.message)
    if (match != undefined) {
      const t = context.application.getTranslatorForBridge(context.clientInstance.bridgeId)
      const originEventId = context.clientInstance.getLastEventIdForSentChatMessage()
      if (originEventId === undefined) {
        context.logger.warn('No originEventId detected. Dropping the event')
        return
      }
      await context.application.emit('minecraftChatEvent', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Info,
        type: MinecraftReactiveEventType.Advertise,
        originEventId: originEventId,
        message: t('instance.reaction.advertise'),
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
