import DefaultAxios from 'axios'
import type { APIEmbed } from 'discord.js'
import { SlashCommandBuilder, SlashCommandStringOption } from 'discord.js'

import { Color } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { DefaultCommandFooter } from '../common/discord-config.js'

function createNamesEmbed(
  username: string,
  uuid: string,
  history: { username: string; changed_at?: string }[]
): APIEmbed {
  const names = history
    .map((entry) => {
      if (entry.changed_at) {
        const date = new Date(entry.changed_at)
        return `\`${entry.username}\` (<t:${Math.floor(date.getTime() / 1000)}:R>)`
      }
      return `\`${entry.username}\` (Original)`
    })
    .toReversed()

  return {
    color: Color.Default,
    title: `📛 Name History: ${username}`,
    thumbnail: {
      url: `https://mc-heads.net/avatar/${uuid}/100`
    },
    description: names.join('\n'),
    footer: {
      text: DefaultCommandFooter
    }
  }
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('names')
      .setDescription("View a player's name history")
      .addStringOption(
        new SlashCommandStringOption().setName('username').setDescription('Minecraft username').setRequired(true)
      ),

  handler: async function (context) {
    const username = context.interaction.options.getString('username', true)

    await context.interaction.deferReply()

    try {
      const profile = await context.application.mojangApi.profileByUsername(username).catch(() => undefined)
      if (!profile) {
        await context.interaction.editReply(`Could not find player: \`${username}\``)
        return
      }

      const response = await DefaultAxios.get<AshconResponse>(`https://api.ashcon.app/mojang/v2/user/${profile.id}`)
      const history = response.data.username_history

      if (!history || history.length === 0) {
        await context.interaction.editReply(`\`${username}\` has no name history.`)
        return
      }

      await context.interaction.editReply({
        embeds: [createNamesEmbed(response.data.username, profile.id, history)]
      })
    } catch (error) {
      context.logger.error('Error fetching name history:', error)
      await context.interaction.editReply(`An error occurred while fetching name history for \`${username}\`.`)
    }
  }
} satisfies DiscordCommandHandler

interface AshconResponse {
  uuid: string
  username: string
  username_history: {
    username: string
    changed_at?: string
  }[]
}
