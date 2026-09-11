import { ChannelType, Color, GuildGeneralEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const GUILD_LEVEL_REGEX = /^\s+The Guild has reached Level \d+!/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = GUILD_LEVEL_REGEX.exec(context.message)
    if (match != undefined) {
      await context.application.emit('guildGeneral', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Good,
        channels: [ChannelType.Public, ChannelType.Officer],

        type: GuildGeneralEventType.Level,
        message: context.message,
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
