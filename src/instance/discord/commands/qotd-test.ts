import { SlashCommandBuilder, type TextChannel } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { runQotdFlow } from '../../qotd-flow.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('qotd-test')
      .setDescription('Test the QOTD flow')
      .addBooleanOption((opt) =>
        opt.setName('dry-run').setDescription('Run in test mode without pinging users').setRequired(false)
      ),
  permission: Permission.Admin,

  handler: async function (context) {
    const dryRun = context.interaction.options.getBoolean('dry-run') ?? true

    const channelId = context.application.core.discordConfigurations.getQotdChannelId()
    if (channelId === undefined) {
      await context.interaction.reply('QOTD channel is not configured.')
      return
    }

    await context.interaction.deferReply()

    const guild = context.application.discordInstance.getClient().guilds.cache.first()
    if (!guild) {
      await context.interaction.editReply('No guild available.')
      return
    }

    const fetched = await context.application.discordInstance
      .getClient()
      .channels.fetch(channelId)
      .catch(() => undefined)
    if (!fetched || !fetched.isTextBased() || fetched.isDMBased()) {
      await context.interaction.editReply('QOTD channel is not a valid text channel.')
      return
    }

    context.logger.info(`[qotd] manual test triggered, dryRun=${dryRun}`)
    await runQotdFlow(fetched as TextChannel, guild, dryRun, context.logger)
    await context.interaction.editReply(`QOTD flow completed (dryRun=${dryRun}).`)
  }
} satisfies DiscordCommandHandler
