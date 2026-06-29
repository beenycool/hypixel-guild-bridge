import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands'

interface AppSettingRow {
  value: string
}

async function getBaseUrl(context: Readonly<DiscordCommandContext>): Promise<string> {
  try {
    const rows = await context.application.core.databaseManager.queryRows<AppSettingRow>(
      `SELECT "value" FROM "app_settings" WHERE "key" = 'public_url'`
    )
    if (rows.length > 0 && rows[0].value) return rows[0].value
  } catch {
    // DB not available, fall through
  }

  const herokuApp = process.env.HEROKU_APP_NAME
  if (herokuApp) return `https://${herokuApp}.herokuapp.com`
  return 'http://localhost:' + process.env.PORT
}

export default {
  getCommandBuilder: () => new SlashCommandBuilder().setName('rankup-url').setDescription('Get the rankup web UI URL'),

  permission: Permission.Helper,

  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { interaction } = context
    const base = await getBaseUrl(context)

    const embed = new EmbedBuilder()
      .setTitle('Rankup Web UI')
      .setDescription(`Base URL: \`${base}\``)
      .addFields(
        { name: 'Dashboard', value: `[Open](${base}/)`, inline: true },
        { name: 'Pending Reviews', value: `[Open](${base}/rankup-pending.html)`, inline: true },
        { name: 'History', value: `[Open](${base}/rankup-history.html)`, inline: true },
        { name: 'Rules Editor', value: `[Open](${base}/rankup-rules.html)`, inline: true }
      )
      .setColor(0x00_aa_ff)

    await interaction.reply({ embeds: [embed], ephemeral: true })
  }
} satisfies DiscordCommandHandler
