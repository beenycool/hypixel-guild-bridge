import { ChannelType, Color, GuildPlayerEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const GUILD_JOIN_REGEX = /^(?:\[[+A-Za-z]{3,10}] ){0,3}(\w{3,32}) joined the guild!/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = GUILD_JOIN_REGEX.exec(context.message)
    if (match != undefined) {
      const username = match[1]
      const uuid = await context.application.mojangApi.profileByUsername(username).then((profile) => profile.id)
      const user = await context.application.core.initializeMinecraftUser(
        { name: username, id: uuid },
        { bridgeId: context.clientInstance.bridgeId }
      )

      await context.application.emit('guildPlayer', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Good,
        channels: [ChannelType.Public, ChannelType.Officer],

        type: GuildPlayerEventType.Join,
        user: user,
        message: context.message,
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
