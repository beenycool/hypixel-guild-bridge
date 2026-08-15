import {
  ChannelType,
  Color,
  GuildPlayerEventType,
  MinecraftSendChatPriority
} from '../../../common/application-event.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

export default {
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const regex = /(?:\[[+A-Za-z]{3,10}] ){0,3}(\w{3,32}) has requested to join the Guild/g

    const match = regex.exec(context.message)
    if (match != undefined) {
      context.logger.info(`[join-request] detected request from ${match[1]} | message: "${context.message}"`)
      const username = match[1]
      const uuid = await context.application.mojangApi.profileByUsername(username).then((profile) => profile.id)
      const user = await context.application.core.initializeMinecraftUser({ name: username, id: uuid }, {})

      await context.application.emit('guildPlayer', {
        ...context.eventHelper.fillBaseEvent(),

        color: Color.Good,
        channels: [ChannelType.Officer],

        type: GuildPlayerEventType.Request,
        user: user,
        message: `${username} has requested to join the guild!`,
        rawMessage: context.rawMessage
      })

      for (const command of [`!bw ${username}`, `!b ${username}`, `!d ${username}`]) {
        await context.application
          .sendMinecraft([context.instanceName], MinecraftSendChatPriority.Default, undefined, `/oc ${command}`)
          .catch(context.errorHandler.promiseCatch(`sending ${command} for join request`))
      }
    } else if (context.message.includes('requested to join')) {
      context.logger.debug(`[join-request] near-miss message: "${context.message}"`)
    }
  }
} satisfies MinecraftChatMessage
