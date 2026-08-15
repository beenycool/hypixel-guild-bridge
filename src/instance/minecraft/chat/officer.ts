import { ChannelType } from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'
import { getUuidFromGuildChat } from '../common/common'

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const regex = /^Officer > (?:\[([+A-Z]{1,10})] ){0,3}(\w{3,32})(?: \[(\w{1,10})]){0,3}:(.{1,256})/g

    const match = regex.exec(context.message)
    if (match != undefined) {
      const hypixelRank = match[1]
      const username = match[2]
      const guildRank = match[3]
      const playerMessage = match[4].trim()

      const uuid = getUuidFromGuildChat(context.jsonMessage)
      const user = await context.application.core.initializeMinecraftUser({ name: username, id: uuid }, {})

      context.application.mojangApi.cache([{ name: username, id: uuid }])
      if (context.application.minecraftManager.isMinecraftBot(username)) {
        const isEcho = context.clientInstance.notifyChatEvent(ChannelType.Officer, playerMessage)
        if (isEcho) {
          const prefixes = ['§2Guild > ', '§3Officer > ']
          let body = context.rawMessage
          for (const prefix of prefixes) {
            if (body.startsWith(prefix)) {
              body = body.slice(prefix.length)
              break
            }
          }
          const colonIndex = body.indexOf(': ')
          if (colonIndex !== -1) {
            const rankPart = body.slice(0, colonIndex)
            if (rankPart.length > 0) {
              context.application.minecraftManager.setBotRank(context.instanceName, rankPart)
            }
          }
          return
        }
      }

      const bridgeId = context.clientInstance.bridgeId
      const { filteredMessage } = context.application.core.filterProfanityForBridge(playerMessage, bridgeId)

      const event = context.eventHelper.fillBaseEvent()
      context.messageAssociation.addMessageId(event.eventId, { channel: ChannelType.Officer })
      await context.application.emit('chat', {
        ...event,

        channelType: ChannelType.Officer,

        user: user,
        hypixelRank: hypixelRank,
        guildRank: guildRank,

        message: filteredMessage,
        rawMessage: context.rawMessage
      })
    }
  }
} satisfies MinecraftChatMessage
