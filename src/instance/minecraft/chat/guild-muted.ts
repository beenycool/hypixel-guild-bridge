import { Color, MinecraftReactiveEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const GUILD_MUTED_STATUS_REGEX = /^You're currently guild muted for ([dhms0-9\s]+)!/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = GUILD_MUTED_STATUS_REGEX.exec(context.message)
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
