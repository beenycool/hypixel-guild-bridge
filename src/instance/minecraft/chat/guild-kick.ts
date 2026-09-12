import assert from 'node:assert'

import { ChannelType, Color, GuildPlayerEventType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

const GUILD_KICKED_REGEX = /^You were kicked from the guild by/

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const match = GUILD_KICKED_REGEX.exec(context.message)
    if (match != undefined) {
      const t = context.application.getTranslatorForBridge(context.clientInstance.bridgeId)
      const name = context.clientInstance.username()
      const uuid = context.clientInstance.uuid()
      assert.ok(name !== undefined)
      assert.ok(uuid !== undefined)
      const botUser = await context.application.core.initializeMinecraftUser(
        { id: uuid, name: name },
        { bridgeId: context.clientInstance.bridgeId }
      )

      await context.application.emit('guildPlayer', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Bad,
        channels: [ChannelType.Public, ChannelType.Officer],

        type: GuildPlayerEventType.Kicked,
        user: botUser,
        message: t('instance.reaction.guild-kicked'),
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
