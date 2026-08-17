import { escapeMarkdown, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { checkChatTriggers, MuteChat } from '../../../utility/chat-triggers.js'
import {
  getBridgeMinecraftInstanceError,
  getFirstConnectedBridgeMinecraftInstanceName
} from '../common/bridge-minecraft-instances.js'
import { formatChatTriggerResponse } from '../common/chattrigger-format.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Mute a guild member in-game')
      .addStringOption((option) =>
        option.setName('username').setDescription('Username of the player').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) =>
        option.setName('duration').setDescription('Duration of the mute (e.g. 30m, 1h, 1d)').setRequired(true)
      )
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the mute').setRequired(false)),

  permission: Permission.Helper,
  handler: async function (context) {
    await context.interaction.deferReply()

    const username = context.interaction.options.getString('username', true)
    const duration = context.interaction.options.getString('duration', true)
    const reason = context.interaction.options.getString('reason')
    const command = reason ? `/g mute ${username} ${duration} ${reason}` : `/g mute ${username} ${duration}`

    const instance = getFirstConnectedBridgeMinecraftInstanceName(context.application, context.bridgeId)
    if (!instance) {
      await context.interaction.editReply(getBridgeMinecraftInstanceError(context.application, context.bridgeId))
      return
    }

    const result = await checkChatTriggers(
      context.application,
      context.eventHelper,
      MuteChat,
      [instance],
      command,
      username
    )
    const formatted = formatChatTriggerResponse(result, `Mute ${escapeMarkdown(username)}`)
    await context.interaction.editReply({ embeds: [formatted] })
  },
  autoComplete: async function (context) {
    const option = context.interaction.options.getFocused(true)
    if (option.name === 'username') {
      const completedUsernames = await context.application.core.completeUsername(option.value, 25)
      const response = completedUsernames.map((choice) => ({
        name: choice,
        value: choice
      }))
      await context.interaction.respond(response)
    }
  }
} satisfies DiscordCommandHandler
