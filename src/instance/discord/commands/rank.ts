import { escapeMarkdown, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { checkChatTriggers, RankChat } from '../../../utility/chat-triggers.js'
import {
  getBridgeMinecraftInstanceError,
  getFirstConnectedBridgeMinecraftInstanceName
} from '../common/bridge-minecraft-instances.js'
import { formatChatTriggerResponse } from '../common/chattrigger-format.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Manage guild member ranks')
      .addSubcommand((sub) =>
        sub
          .setName('promote')
          .setDescription('Promote a guild member')
          .addStringOption((opt) =>
            opt.setName('username').setDescription('Username of the player').setRequired(true).setAutocomplete(true)
          )
          .addStringOption((opt) =>
            opt.setName('rank').setDescription('Rank to set').setRequired(false).setAutocomplete(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('demote')
          .setDescription('Demote a guild member')
          .addStringOption((opt) =>
            opt.setName('username').setDescription('Username of the player').setRequired(true).setAutocomplete(true)
          )
      ),
  permission: Permission.Owner,

  handler: async function (context) {
    await context.interaction.deferReply()

    const subcommand = context.interaction.options.getSubcommand()
    const username = context.interaction.options.getString('username', true)
    const instance = getFirstConnectedBridgeMinecraftInstanceName(context.application, context.bridgeId)
    if (instance === undefined) {
      await context.interaction.editReply(getBridgeMinecraftInstanceError(context.application, context.bridgeId))
      return
    }

    let command: string
    let label: string
    if (subcommand === 'promote') {
      const rank = context.interaction.options.getString('rank')
      if (rank === null) {
        command = `/g promote ${username}`
        label = `Promote ${escapeMarkdown(username)}`
      } else {
        command = `/g setrank ${username} ${rank}`
        label = `Setrank ${escapeMarkdown(username)}`
      }
    } else {
      command = `/g demote ${username}`
      label = `Demote ${escapeMarkdown(username)}`
    }

    const result = await checkChatTriggers(
      context.application,
      context.eventHelper,
      RankChat,
      [instance],
      command,
      username
    )
    const formatted = formatChatTriggerResponse(result, label)

    await context.interaction.editReply({ embeds: [formatted] })
  },
  autoComplete: async function (context) {
    const option = context.interaction.options.getFocused(true)
    if (option.name === 'username') {
      const usernameChoices = await context.application.core.completeUsername(option.value, 25)
      const response = usernameChoices.map((choice) => ({
        name: choice,
        value: choice
      }))
      await context.interaction.respond(response)
    } else if (option.name === 'rank') {
      const rankChoices = await context.application.core.completeRank(option.value, 25)
      const response = rankChoices.map((choice) => ({
        name: choice,
        value: choice
      }))
      await context.interaction.respond(response)
    }
  }
} satisfies DiscordCommandHandler
