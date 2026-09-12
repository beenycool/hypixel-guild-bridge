import { SlashCommandBuilder } from 'discord.js'

import { InstanceSignalType, Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { OptionToAddMinecraftInstances } from '../../../common/commands.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('disconnect').setDescription('disconnect minecraft clients'),
  addMinecraftInstancesToOptions: OptionToAddMinecraftInstances.Required,
  permission: Permission.Helper,

  handler: async function (context) {
    await context.interaction.deferReply()

    const target = context.interaction.options.getString('instance', true)
    const bridgeId = context.bridgeId
    if (bridgeId === undefined || !context.application.bridgeResolver.shouldProcessEvent(bridgeId, target)) {
      await context.interaction.editReply('This instance does not belong to this bridge.')
      return
    }

    await context.application.sendSignal([target], InstanceSignalType.Shutdown)
    await context.interaction.editReply('disconnect signal has been sent!')
  }
} satisfies DiscordCommandHandler
