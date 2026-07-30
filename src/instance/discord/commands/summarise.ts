import { SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('summarise').setDescription('Manually trigger the daily chat summary generation'),
  permission: Permission.Admin,

  handler: async function (context) {
    await context.interaction.deferReply()

    try {
      await context.application.chatSummarySchedulerInstance.generateAndPostSummaries(context.interaction.channelId)
      await context.interaction.editReply({ content: 'Chat summary generation triggered successfully!' })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      await context.interaction.editReply({ content: `Chat summary generation failed: ${message}` })
    }
  }
} satisfies DiscordCommandHandler
