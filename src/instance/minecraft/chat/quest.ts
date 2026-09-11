import { ChannelType, Color, GuildGeneralEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const QUEST_TIER_REGEX = /^GUILD QUEST TIER [1-9] COMPLETED!/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = QUEST_TIER_REGEX.exec(context.message.trim())
    if (match != undefined) {
      await context.application.emit('guildGeneral', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Good,
        channels: [ChannelType.Public],

        type: GuildGeneralEventType.Quest,
        message: context.message.trim(),
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
