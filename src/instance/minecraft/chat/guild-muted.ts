import { Color, MinecraftReactiveEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const regex = /^You're currently guild muted for ([dhms0-9\s]+)!/g

    const match = regex.exec(context.message)
    if (match != undefined) {
      const t = context.application.getTranslatorForBridge(context.clientInstance.bridgeId)
      const formattedDuration = match[1]

      const originEventId = context.clientInstance.getLastEventIdForSentGuildAction()
      if (originEventId === undefined) {
        context.logger.warn('No originEventId detected. Dropping the event')
        return
      }
      await context.application.emit('minecraftChatEvent', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Info,
        type: MinecraftReactiveEventType.GuildMuted,
        originEventId: originEventId,
        message: t('instance.reaction.guild-muted-status', { duration: formattedDuration }),
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
