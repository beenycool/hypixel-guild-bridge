import { Color, MinecraftReactiveEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const REQUIRE_GUILD_REGEX = /^You must be in a guild to use this command!/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = REQUIRE_GUILD_REGEX.exec(context.message)
    if (match != undefined) {
      const originEventId = context.clientInstance.getLastEventIdForSentGuildAction()
      if (originEventId === undefined) {
        context.logger.warn('No originEventId detected. Dropping the event')
        return
      }
      await context.application.emit('minecraftChatEvent', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Info,
        type: MinecraftReactiveEventType.RequireGuild,
        originEventId: originEventId,
        message: context.message,
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
