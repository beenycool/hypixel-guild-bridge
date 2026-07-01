import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands.js'

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
  return 'http://localhost:' + (process.env.PORT ?? '8080')
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('dashboard').setDescription('Open the web dashboard for bridge management'),

  permission: Permission.Officer,

  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { interaction } = context
    const webConfig = context.application.getWebConfig()
    if (!webConfig || !webConfig.token) {
      await interaction.reply({ content: 'Web server is not configured.', ephemeral: true })
      return
    }
    const base = await getBaseUrl(context)
    const token = webConfig.token
    const t = encodeURIComponent(token)

    const embed = new EmbedBuilder()
      .setTitle('Web Dashboard')
      .setDescription('Manage your bridges, settings, and rankup rules via the web interface.')
      .addFields(
        { name: 'Overview', value: `[Open](${base}/?token=${t})`, inline: true },
        { name: 'Settings', value: `[Open](${base}/settings.html?token=${t})`, inline: true },
        { name: 'Pending Reviews', value: `[Open](${base}/rankup-pending.html?token=${t})`, inline: true },
        { name: 'History', value: `[Open](${base}/rankup-history.html?token=${t})`, inline: true },
        { name: 'Rules Editor', value: `[Open](${base}/rankup-rules.html?token=${t})`, inline: true }
      )
      .setColor(0x00_aa_ff)

    await interaction.reply({ embeds: [embed], ephemeral: true })
  }
} satisfies DiscordCommandHandler
