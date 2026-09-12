import { ChannelType, Color, GuildPlayerEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const DEMOTE_REGEX = /^(?:\[[+A-Z]{1,10}] )*(\w{3,32}) was demoted from /

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = DEMOTE_REGEX.exec(context.message)
    if (match != undefined) {
      const username = match[1]
      const uuid = await context.application.mojangApi.profileByUsername(username).then((profile) => profile.id)
      const user = await context.application.core.initializeMinecraftUser(
        { id: uuid, name: username },
        { bridgeId: context.clientInstance.bridgeId }
      )

      await context.application.emit('guildPlayer', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Bad,
        channels: [ChannelType.Public, ChannelType.Officer],

        type: GuildPlayerEventType.Demote,
        user: user,
        message: context.message,
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
