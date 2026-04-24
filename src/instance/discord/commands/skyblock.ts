import { SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('skyblock')
      .setDescription('Manage Skyblock event notifications')
      .addSubcommand(
        new SlashCommandSubcommandBuilder()
          .setName('toggle')
          .setDescription('Enable/disable Skyblock events globally for a bridge or a single event')
          .addBooleanOption((option) => option.setName('enabled').setDescription('Enable or disable').setRequired(true))
          .addStringOption((option) => option.setName('event').setDescription('Event key (optional)'))
          .addStringOption((option) => option.setName('bridge').setDescription('Bridge ID (optional)'))
      ),

  permission: Permission.Anyone,

  handler: async function (context) {
    const interaction = context.interaction
    const sub = interaction.options.getSubcommand(true)

    if (sub === 'toggle') {
      await interaction.deferReply({ ephemeral: true })

      const enabled = interaction.options.getBoolean('enabled', true)
      const eventKey = interaction.options.getString('event') ?? undefined
      let bridgeId = interaction.options.getString('bridge') ?? undefined

      if (!bridgeId && interaction.channelId) {
        bridgeId = context.application.bridgeResolver.getBridgeIdForChannel(interaction.channelId)
      }

      if (!bridgeId) {
        await interaction.editReply('Could not determine bridge. Please specify the `bridge` option.')
        return
      }

      const bridgeConfig = context.application.core.bridgeConfigurations

      if (eventKey !== undefined) {
        bridgeConfig.setSkyblockEventNotifier(bridgeId, eventKey, enabled)
        await context.application.emit('bridgeConfigChanged', {
          bridgeId,
          key: `${bridgeId}_skyblockNotifiers`,
          value: { [eventKey]: enabled }
        })
        await interaction.editReply(
          `Skyblock event \`${eventKey}\` has been ${enabled ? 'enabled' : 'disabled'} for bridge \`${bridgeId}\`.`
        )
        return
      }

      bridgeConfig.setSkyblockEventsEnabled(bridgeId, enabled)
      await context.application.emit('bridgeConfigChanged', {
        bridgeId,
        key: `${bridgeId}_skyblockEventsEnabled`,
        value: enabled
      })
      await interaction.editReply(
        `Skyblock events have been ${enabled ? 'enabled' : 'disabled'} for bridge \`${bridgeId}\`.`
      )
    }
  }
} satisfies DiscordCommandHandler
