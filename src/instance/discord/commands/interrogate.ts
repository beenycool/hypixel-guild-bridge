import { escapeMarkdown, SlashCommandBuilder, SlashCommandStringOption } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { OptionToAddMinecraftInstances } from '../../../common/commands.js'
import {
  getBridgeMinecraftInstanceError,
  getFirstConnectedBridgeMinecraftInstanceName
} from '../common/bridge-minecraft-instances.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('interrogate')
      .setDescription('Party-invite a player that requested to join the guild and ask if they are an alt')
      .addStringOption(
        new SlashCommandStringOption()
          .setName('username')
          .setDescription('Minecraft username')
          .setRequired(true)
          .setAutocomplete(true)
      ),
  addMinecraftInstancesToOptions: OptionToAddMinecraftInstances.Optional,
  permission: Permission.Helper,

  handler: async function (context) {
    await context.interaction.deferReply()

    const username = context.interaction.options.getString('username', true)
    const instance =
      context.interaction.options.getString('instance') ??
      getFirstConnectedBridgeMinecraftInstanceName(context.application, context.bridgeId)
    if (instance === undefined) {
      await context.interaction.editReply(getBridgeMinecraftInstanceError(context.application, context.bridgeId))
      return
    }

    const bridgeId = context.application.bridgeResolver.getBridgeIdForInstance(instance)
    const dynamicInterviewEnabled =
      bridgeId !== undefined &&
      (context.application.core.bridgeConfigurations.getInterviewEnabled(bridgeId) ||
        context.application.core.bridgeConfigurations.getInterviewQuestion(bridgeId) !== '')
    const staticInterviewEnabled =
      context.application.config.bridges?.find((b) => b.id === bridgeId)?.interview !== undefined
    if (!dynamicInterviewEnabled && !staticInterviewEnabled) {
      await context.interaction.editReply(
        'The interview feature is not enabled for this bridge. Enable it in the web dashboard settings.'
      )
      return
    }

    const minecraftInstance = context.application.minecraftManager
      .getAllInstances()
      .find((inst) => inst.instanceName.toLowerCase() === instance.toLowerCase())
    if (minecraftInstance === undefined || minecraftInstance.isInterviewing(username)) {
      await context.interaction.editReply(
        `\`${escapeMarkdown(username)}\` already has an active interview on \`${instance}\`.`
      )
      return
    }

    await context.application.emit('joinInterviewRequest', { instanceName: instance, username })
    await context.interaction.editReply(
      `Interrogation started for \`${escapeMarkdown(username)}\` on \`${instance}\`. They will be asked if they are an alt via private message. Reply in officer chat to talk with them; prefix your message with \`-\` to keep it internal.`
    )
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
