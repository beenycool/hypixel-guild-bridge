import { SlashCommandBuilder } from 'discord.js'

import { MinecraftSendChatPriority, Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import {
  getBridgeMinecraftInstanceError,
  getFirstConnectedBridgeMinecraftInstanceName
} from '../common/bridge-minecraft-instances.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('execute')
      .setDescription('execute command in-game via Minecraft client')
      .addStringOption((option) =>
        option.setName('command').setDescription('command to execute. e.g. "/guild party"').setRequired(true)
      ),
  permission: Permission.Owner,

  handler: async function (context) {
    await context.interaction.deferReply()

    const command: string = context.interaction.options.getString('command', true)
    const instance = getFirstConnectedBridgeMinecraftInstanceName(context.application, context.bridgeId)
    if (instance === undefined) {
      await context.interaction.editReply(getBridgeMinecraftInstanceError(context.application, context.bridgeId))
      return
    }

    await context.application.sendMinecraft([instance], MinecraftSendChatPriority.High, undefined, command)
    await context.interaction.editReply(`Command executed: ${command}`)
  }
} satisfies DiscordCommandHandler
