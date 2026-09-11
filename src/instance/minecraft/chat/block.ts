import { Color, MinecraftReactiveEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const BLOCKED_COMMENT_REGEX = /^We blocked your comment "[\W\w]+" because/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = BLOCKED_COMMENT_REGEX.exec(context.message)
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
        type: MinecraftReactiveEventType.Block,
        originEventId: originEventId,
        message: t('instance.reaction.block'),
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
