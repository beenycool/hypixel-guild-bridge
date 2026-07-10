import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands.js'
import { signToken } from '../../../instance/web/signed-token.js'

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
    new SlashCommandBuilder()
      .setName('dashboard')
      .setDescription('Open the web dashboard for bridge management')
      .addStringOption((opt) =>
        opt
          .setName('page')
          .setDescription('Page to open (optional)')
          .setRequired(false)
          .addChoices(
            { name: 'Overview', value: 'home' },
            { name: 'Guild Overview', value: 'guild' },
            { name: 'Pending Reviews', value: 'rankup-pending' },
            { name: 'History', value: 'rankup-history' },
            { name: 'Settings', value: 'settings' },
            { name: 'Bot Messages', value: 'bot-messages' },
            { name: 'Punishments', value: 'punishments' },
            { name: 'Inactivity', value: 'inactivity' }
          )
      ),

  permission: Permission.Helper,

  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { interaction } = context
    const userId = interaction.user.id
    const discordInstance = context.application.discordInstance
    const userPermission = await discordInstance.resolvePermission(userId)

    if (userPermission < Permission.Helper) {
      await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
      return
    }

    const webConfig = context.application.config.web
    if (!webConfig?.signingSecret) {
      await interaction.reply({ content: 'Web server is not configured.', ephemeral: true })
      return
    }
    const base = await getBaseUrl(context)
    const signingSecret = webConfig.signingSecret
    const signedToken = signToken(
      {
        sub: userId,
        perm: userPermission,
        exp: Math.floor(Date.now() / 1000) + 86_400,
        iat: Math.floor(Date.now() / 1000)
      },
      signingSecret
    )
    const t = encodeURIComponent(signedToken)

    const page = context.interaction.options.getString('page') ?? ''
    let pagePath = page && page !== 'home' ? `${page}.html` : ''
    let urlSuffix = `?token=${t}`
    if (page === 'bot-messages') {
      pagePath = 'settings.html'
      urlSuffix = `?cat=translations&token=${t}`
    }

    if (pagePath) {
      const embed = new EmbedBuilder()
        .setTitle('Web Dashboard')
        .setDescription(`Open the [dashboard](${base}/${pagePath}${urlSuffix}) to manage your bridge settings.`)
        .setColor(0x00_aa_ff)

      await interaction.reply({ embeds: [embed], ephemeral: true })
      return
    }

    const showSettings = userPermission >= Permission.Owner

    const fields = []
    if (showSettings) {
      fields.push(
        { name: 'Settings', value: `[Open](${base}/settings.html?token=${t})`, inline: true },
        { name: 'Rankup Config', value: `[Open](${base}/settings.html?cat=rankup&token=${t})`, inline: true }
      )
    }
    fields.push(
      { name: 'Overview', value: `[Open](${base}/?token=${t})`, inline: true },
      { name: 'Pending Reviews', value: `[Open](${base}/rankup-pending.html?token=${t})`, inline: true },
      { name: 'History', value: `[Open](${base}/rankup-history.html?token=${t})`, inline: true }
    )

    const embed = new EmbedBuilder()
      .setTitle('Web Dashboard')
      .setDescription('Manage your bridges and settings via the web interface.')
      .addFields(fields)
      .setColor(0x00_aa_ff)

    await interaction.reply({ embeds: [embed], ephemeral: true })
  }
} satisfies DiscordCommandHandler
