import { Color, MinecraftReactiveEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const regex = /^You cannot say the same message twice!/g

    const match = regex.exec(context.message)
    if (match != undefined) {
      const t = context.application.getTranslatorForBridge(context.clientInstance.bridgeId)
      const raw = t('instance.repeat.messages')
      const messages: string[] = JSON.parse(raw)
      if (messages.length === 0) {
        context.logger.error('There is no repeat messages. Dropping the reaction entirely.')
        return
      }
      const randomMessage = messages[Math.floor(Math.random() * messages.length)]
      const originEventId = context.clientInstance.getLastEventIdForSentChatMessage()
      if (originEventId === undefined) {
        context.logger.warn('No originEventId detected. Dropping the event')
        return
      }

      await context.application.emit('minecraftChatEvent', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Info,
        type: MinecraftReactiveEventType.Repeat,
        originEventId: originEventId,
        message: randomMessage,
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
