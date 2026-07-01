import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import { signToken } from '../../../instance/web/signed-token.js'
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

  permission: Permission.Helper,

  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { interaction } = context
    const userId = interaction.user.id
    const discordInstance = context.application.discordInstance
    const userPermission = discordInstance?.resolvePermission(userId) ?? Permission.Anyone

    if (userPermission < Permission.Helper) {
      await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
      return
    }

    const webConfig = context.application.getWebConfig()
    if (!webConfig || !webConfig.token) {
      await interaction.reply({ content: 'Web server is not configured.', ephemeral: true })
      return
    }
    const base = await getBaseUrl(context)
    const signingSecret = webConfig.signingSecret ?? webConfig.token
    const signedToken = signToken(
      {
        sub: userId,
        perm: userPermission,
        exp: Math.floor(Date.now() / 1000) + 86400,
        iat: Math.floor(Date.now() / 1000)
      },
      signingSecret
    )
    const t = encodeURIComponent(signedToken)

    const showSettings = userPermission >= Permission.Owner

    const fields = [
      { name: 'Overview', value: `[Open](${base}/?token=${t})`, inline: true },
      { name: 'Pending Reviews', value: `[Open](${base}/rankup-pending.html?token=${t})`, inline: true },
      { name: 'History', value: `[Open](${base}/rankup-history.html?token=${t})`, inline: true }
    ]
    if (showSettings) {
      fields.push(
        { name: 'Settings', value: `[Open](${base}/settings.html?token=${t})`, inline: true },
        { name: 'Rankup Config', value: `[Open](${base}/settings.html?token=${t})`, inline: true }
      )
    }

    const embed = new EmbedBuilder()
      .setTitle('Web Dashboard')
      .setDescription('Manage your bridges, settings, and rankup rules via the web interface.')
      .addFields(fields)
      .setColor(0x00_aa_ff)

    await interaction.reply({ embeds: [embed], ephemeral: true })
  }
} satisfies DiscordCommandHandler
