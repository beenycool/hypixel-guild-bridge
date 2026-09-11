import { escapeMarkdown, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { checkChatTriggers, UnmuteChat } from '../../../utility/chat-triggers.js'
import {
  getBridgeMinecraftInstanceError,
  getFirstConnectedBridgeMinecraftInstanceName
} from '../common/bridge-minecraft-instances.js'
import { formatChatTriggerResponse } from '../common/chattrigger-format.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Unmute a guild member in-game')
      .addStringOption((option) =>
        option.setName('username').setDescription('Username of the player').setRequired(true).setAutocomplete(true)
      ),

  permission: Permission.Helper,
  handler: async function (context) {
    await context.interaction.deferReply()

    const username = context.interaction.options.getString('username', true)
    const instance = getFirstConnectedBridgeMinecraftInstanceName(context.application, context.bridgeId)
    if (!instance) {
      await context.interaction.editReply(getBridgeMinecraftInstanceError(context.application, context.bridgeId))
      return
    }

    const result = await checkChatTriggers(
      context.application,
      context.eventHelper,
      UnmuteChat,
      [instance],
      `/g unmute ${username}`,
      username
    )
    const formatted = formatChatTriggerResponse(result, `Unmute ${escapeMarkdown(username)}`)
    await context.interaction.editReply({ embeds: [formatted] })
  }
} satisfies DiscordCommandHandler
