import { Color, MinecraftReactiveEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const NO_OFFICER_REGEX = /^You don't have access to the officer chat!/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = NO_OFFICER_REGEX.exec(context.message)
    if (match != undefined) {
      const originEventId = context.clientInstance.getLastEventIdForSentChatMessage()
      if (originEventId === undefined) {
        context.logger.warn('No originEventId detected. Dropping the event')
        return
      }
      await context.application.emit('minecraftChatEvent', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Info,
        type: MinecraftReactiveEventType.NoOfficer,
        originEventId: originEventId,
        message: context.message,
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
