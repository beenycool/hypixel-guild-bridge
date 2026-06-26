import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type Guild,
  type Message,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  type TextChannel
} from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'

const QotdUsers = ['fluffydeadmuffin', 'spleeney_', 'flqw3d'] as const

const QotdSubcommandStart = 'start'
const QotdSubcommandEnable = 'enable'
const QotdSubcommandDisable = 'disable'
const QotdSubcommandChannel = 'channel'

const QotdCommandName = 'qotd'

export async function runQotdFlow(channel: TextChannel, guild: Guild): Promise<void> {
  const members = QotdUsers.map((name) => guild.members.cache.find((member) => member.user.username === name)).filter(
    (member): member is NonNullable<typeof member> => member !== undefined
  )

  if (members.length === 0) {
    await channel.send('None of the QOTD members were found in this guild.')
    return
  }

  let currentIndex = 0
  let message: Message<true> | null = null

  while (currentIndex < members.length) {
    const user = members[currentIndex]

    const acceptButton = new ButtonBuilder()
      .setCustomId('qotd_accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅')

    const passButton = new ButtonBuilder()
      .setCustomId('qotd_pass')
      .setLabel('Pass')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptButton, passButton)

    message = await channel.send({
      content: `<@${user.id}> it's your turn to ask the Question of the Day!`,
      components: [row]
    })

    let reminderCount = 0
    const reminderInterval = setInterval(() => {
      reminderCount++
      if (reminderCount <= 9) {
        message?.reply(`⏰ Reminder: <@${user.id}> please respond to the QOTD request!`).catch(() => undefined)
      }
    }, 60_000)

    try {
      const interaction = await message.awaitMessageComponent({
        filter: (interaction) =>
          interaction.user.id === user.id &&
          (interaction.customId === 'qotd_accept' || interaction.customId === 'qotd_pass'),
        time: 600_000,
        componentType: ComponentType.Button
      })

      clearInterval(reminderInterval)

      if (interaction.customId === 'qotd_accept') {
        await interaction.update({
          content: `<@${user.id}> will do QOTD today!`,
          components: []
        })
        return
      }

      await interaction.update({
        content: `<@${user.id}> passed. Moving to next person...`,
        components: []
      })
      currentIndex++
    } catch {
      clearInterval(reminderInterval)
      await message?.edit({
        content: `<@${user.id}> didn't respond. Moving to next person...`,
        components: []
      })
      currentIndex++
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  await message?.edit({
    content: '❌ No one is available for QOTD today!',
    components: []
  })
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName(QotdCommandName)
      .setDescription('Manage and run Question of the Day')
      .addSubcommand(
        new SlashCommandSubcommandBuilder()
          .setName(QotdSubcommandStart)
          .setDescription('Assign Question of the Day to someone')
      )
      .addSubcommand(
        new SlashCommandSubcommandBuilder().setName(QotdSubcommandEnable).setDescription('Enable the QOTD feature')
      )
      .addSubcommand(
        new SlashCommandSubcommandBuilder().setName(QotdSubcommandDisable).setDescription('Disable the QOTD feature')
      )
      .addSubcommand(
        new SlashCommandSubcommandBuilder()
          .setName(QotdSubcommandChannel)
          .setDescription('Set the channel for QOTD')
          .addChannelOption((o) => o.setName('channel').setDescription('The channel to send QOTD to').setRequired(true))
      ),
  permission: Permission.Helper,

  handler: async function (context) {
    const subcommand = context.interaction.options.getSubcommand()
    const configManager = context.application.commandConfigManager

    if (subcommand === QotdSubcommandEnable) {
      await context.interaction.deferReply({ flags: 64 })
      configManager.updateDiscordCommandConfig(QotdCommandName, { enabled: true }, context.interaction.user.id)
      configManager.save()
      await context.interaction.editReply('QOTD has been enabled.')
      return
    }

    if (subcommand === QotdSubcommandDisable) {
      await context.interaction.deferReply({ flags: 64 })
      configManager.updateDiscordCommandConfig(QotdCommandName, { enabled: false }, context.interaction.user.id)
      configManager.save()
      await context.interaction.editReply('QOTD has been disabled.')
      return
    }

    if (subcommand === QotdSubcommandChannel) {
      const channel = context.interaction.options.getChannel('channel', true)
      context.application.core.discordConfigurations.setQotdChannelId(channel.id)
      await context.interaction.reply({
        content: `QOTD channel has been set to <#${channel.id}>.`,
        flags: 64
      })
      return
    }

    if (!configManager.isCommandEnabled('discord', QotdCommandName)) {
      await context.interaction.reply({
        content: 'QOTD is currently disabled. Use `/qotd enable` to enable it.',
        flags: 64
      })
      return
    }

    const guild = context.interaction.guild
    if (!guild) {
      await context.interaction.reply({ content: 'This command can only be used in a server.', flags: 64 })
      return
    }

    const channel = context.interaction.channel
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await context.interaction.reply({ content: 'This command can only be used in a text channel.', flags: 64 })
      return
    }

    await context.interaction.reply({ content: 'Starting QOTD...', flags: 64 })
    await runQotdFlow(channel as TextChannel, guild)
  }
} satisfies DiscordCommandHandler
