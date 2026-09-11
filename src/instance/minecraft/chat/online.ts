import { ChannelType, Color, GuildPlayerEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const GUILD_ONLINE_REGEX = /^Guild > (\w{3,32}) joined./

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = GUILD_ONLINE_REGEX.exec(context.message)
    if (match != undefined) {
      const username = match[1]
      const uuid = await context.application.mojangApi.profileByUsername(username).then((profile) => profile.id)
      const user = await context.application.core.initializeMinecraftUser({ name: username, id: uuid }, {})

      await context.application.emit('guildPlayer', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Good,
        channels: [ChannelType.Public],

        type: GuildPlayerEventType.Online,
        user: user,
        message: context.message,
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
