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
      .setName('messages')
      .setDescription('Open the Bot Messages page to customize what the bot says'),

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

    const embed = new EmbedBuilder()
      .setTitle('Bot Messages')
      .setDescription(
        `Customize what the bot says for this bridge. Open the [Bot Messages page](${base}/settings.html?cat=customMessages&token=${t}) to override any message.`
      )
      .setColor(0x00_aa_ff)

    await interaction.reply({ embeds: [embed], ephemeral: true })
  }
} satisfies DiscordCommandHandler
