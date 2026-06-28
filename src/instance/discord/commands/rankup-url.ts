import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands'

function getBaseUrl(): string {
  const herokuApp = process.env.HEROKU_APP_NAME
  if (herokuApp) return `https://${herokuApp}.herokuapp.com`
  return 'http://localhost:' + process.env.PORT
}

export default {
  getCommandBuilder: () => new SlashCommandBuilder().setName('rankup-url').setDescription('Get the rankup web UI URL'),

  permission: Permission.Helper,

  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { interaction } = context
    const base = getBaseUrl()

    const embed = new EmbedBuilder()
      .setTitle('Rankup Web UI')
      .setDescription(`Base URL: \`${base}\``)
      .addFields(
        { name: 'Dashboard', value: `[Open](${base}/)`, inline: true },
        { name: 'Pending Reviews', value: `[Open](${base}/rankup-pending.html)`, inline: true },
        { name: 'History', value: `[Open](${base}/rankup-history.html)`, inline: true },
        { name: 'Rules Editor', value: `[Open](${base}/rankup-rules.html)`, inline: true }
      )
      .setColor(0x00aaff)

    await interaction.reply({ embeds: [embed], ephemeral: true })
  }
} satisfies DiscordCommandHandler
