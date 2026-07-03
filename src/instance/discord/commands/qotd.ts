import { SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'

const QotdMemberIds = ['878335694295171094', '1173245594752536726', '623714295838015509']

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('qotd')
      .setDescription('Manage QOTD auto-scheduler')
      .addSubcommand((sub) => sub.setName('enable').setDescription('Enable the QOTD auto-scheduler'))
      .addSubcommand((sub) => sub.setName('disable').setDescription('Disable the QOTD auto-scheduler'))
      .addSubcommand((sub) => sub.setName('status').setDescription('Show QOTD auto-scheduler status')),
  permission: Permission.Admin,

  handler: async function (context) {
    const subcommand = context.interaction.options.getSubcommand()

    if (subcommand === 'enable') {
      context.application.commandConfigManager.updateDiscordCommandConfig('qotd', { enabled: true }, 'discord')
      await context.interaction.reply('QOTD auto-scheduler enabled.')
      return
    }

    if (subcommand === 'disable') {
      context.application.commandConfigManager.updateDiscordCommandConfig('qotd', { enabled: false }, 'discord')
      await context.interaction.reply('QOTD auto-scheduler disabled.')
      return
    }

    if (subcommand === 'status') {
      const enabled = context.application.commandConfigManager.isCommandEnabled('discord', 'qotd')
      const channelId = context.application.core.discordConfigurations.getQotdChannelId()

      let channelLine: string
      if (channelId === undefined) {
        channelLine = 'QOTD channel: not configured'
      } else {
        const fetched = await context.application.discordInstance
          .getClient()
          .channels.fetch(channelId)
          .catch(() => undefined)
        if (fetched && 'name' in fetched) {
          channelLine = `QOTD channel: #${fetched.name} (<#${channelId}>)`
        } else {
          channelLine = `QOTD channel: <#${channelId}>`
        }
      }

      const membersLine = `QOTD members: ${QotdMemberIds.map((id) => `<@${id}>`).join(', ')}`
      const enabledLine = `QOTD auto-scheduler: ${enabled ? 'enabled' : 'disabled'}`

      await context.interaction.reply(`${enabledLine}\n${channelLine}\n${membersLine}`)
      return
    }
  }
} satisfies DiscordCommandHandler
