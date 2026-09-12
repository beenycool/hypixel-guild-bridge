import { escapeMarkdown, SlashCommandBuilder, SlashCommandStringOption } from 'discord.js'

import { MinecraftSendChatPriority, Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { OptionToAddMinecraftInstances } from '../../../common/commands.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Add or remove a player from the ignore list')
      .addStringOption(
        new SlashCommandStringOption()
          .setName('action')
          .setDescription('Add or remove from ignore list')
          .setRequired(true)
          .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' })
      )
      .addStringOption(
        new SlashCommandStringOption()
          .setName('username')
          .setDescription('Minecraft username')
          .setRequired(true)
          .setAutocomplete(true)
      ),
  addMinecraftInstancesToOptions: OptionToAddMinecraftInstances.Required,
  permission: Permission.Helper,

  handler: async function (context) {
    await context.interaction.deferReply()

    const action = context.interaction.options.getString('action', true)
    const username = context.interaction.options.getString('username', true)
    const instance = context.interaction.options.getString('instance', true)

    const bridgeId = context.bridgeId
    if (bridgeId === undefined || !context.application.bridgeResolver.shouldProcessEvent(bridgeId, instance)) {
      await context.interaction.editReply('This instance does not belong to this bridge.')
      return
    }

    const command = action === 'add' ? `/ignore add ${username}` : `/ignore remove ${username}`
    await context.application.sendMinecraft([instance], MinecraftSendChatPriority.High, undefined, command)

    const text =
      action === 'add' ? `added \`${escapeMarkdown(username)}\` to` : `removed \`${escapeMarkdown(username)}\` from`
    await context.interaction.editReply(`Successfully ${text} the blacklist.`)
  }
} satisfies DiscordCommandHandler
