import { SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'

const MINECRAFT_NAME_REGEX = /^[a-zA-Z0-9_]{1,16}$/

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('nick')
      .setDescription('Set a custom bot username/skin for rendered chat images')
      .addStringOption((option) =>
        option
          .setName('name')
          .setDescription('Custom Minecraft username. Leave empty to clear.')
          .setRequired(false)
          .setMaxLength(16)
      ),

  permission: Permission.Helper,

  handler: async function (context) {
    const { interaction } = context

    if (context.bridgeId === undefined) {
      await interaction.reply({
        content: 'This command must be used in a configured bridge channel.',
        ephemeral: true
      })
      return
    }

    const name = interaction.options.getString('name')
    const cfg = context.application.core.bridgeConfigurations
    const currentOverride = cfg.getBotUsernameOverride(context.bridgeId)

    if (name === null || name.trim().length === 0) {
      if (currentOverride === undefined) {
        await interaction.reply({
          content: 'No custom nick is set. The bot uses its real Minecraft username.',
          ephemeral: true
        })
        return
      }
      cfg.setBotUsernameOverride(context.bridgeId, undefined)
      await interaction.reply({
        content: 'Cleared custom nick. The bot now uses its real Minecraft username.',
        ephemeral: true
      })
      return
    }

    const trimmed = name.trim()
    if (!MINECRAFT_NAME_REGEX.test(trimmed)) {
      await interaction.reply({
        content: 'Invalid name. Must be 1\u201316 characters: letters, numbers, or underscores.',
        ephemeral: true
      })
      return
    }

    const bots = context.application.minecraftManager.getMinecraftBots()
    const bridgeBots = bots.filter((bot) =>
      context.application.bridgeResolver.shouldProcessEvent(context.bridgeId, bot.instanceName)
    )
    const realName = bridgeBots.length > 0 ? bridgeBots[0].username : 'unknown'

    cfg.setBotUsernameOverride(context.bridgeId, trimmed)

    await interaction.reply({
      content: `Set custom nick to \`${trimmed}\`. Rendered chat images will show \`${trimmed}\` instead of \`${realName}\`.`,
      ephemeral: true
    })
  }
} satisfies DiscordCommandHandler
