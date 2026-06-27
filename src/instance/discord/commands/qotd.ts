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
import type { Logger } from 'log4js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'

const QotdUsers = ['fluffydeadmuffin', 'spleeney_', 'flqw3d'] as const

const QotdSubcommandStart = 'start'
const QotdSubcommandTest = 'test'
const QotdSubcommandEnable = 'enable'
const QotdSubcommandDisable = 'disable'
const QotdSubcommandChannel = 'channel'

const QotdCommandName = 'qotd'

export async function runQotdFlow(channel: TextChannel, guild: Guild, dryRun = false, logger?: Logger): Promise<void> {
  const members = QotdUsers.map((name) => guild.members.cache.find((member) => member.user.username === name)).filter(
    (member): member is NonNullable<typeof member> => member !== undefined
  )

  logger?.info(`[qotd] flow started, dryRun=${dryRun}, members found=${members.length}`)

  if (members.length === 0) {
    logger?.warn('[qotd] no QOTD members found in guild')
    await channel.send('None of the QOTD members were found in this guild.')
    return
  }

  let currentIndex = 0
  let message: Message<true> | null = null

  while (currentIndex < members.length) {
    const user = members[currentIndex]
    const mention = dryRun ? user.user.username : `<@${user.id}>`

    logger?.info(`[qotd] asking user ${user.user.username} (index=${currentIndex})`)

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

    const prefix = dryRun ? '[TEST] ' : ''
    message = await channel.send({
      content: `${prefix}${mention} it's your turn to ask the Question of the Day!`,
      components: [row]
    })

    logger?.info(`[qotd] message sent to channel, messageId=${message.id}`)

    let reminderCount = 0
    const reminderInterval = setInterval(() => {
      reminderCount++
      if (reminderCount <= 9) {
        message?.reply(`⏰ Reminder: ${mention} please respond to the QOTD request!`).catch(() => undefined)
      }
      logger?.debug(`[qotd] reminder ${reminderCount} sent to ${user.user.username}`)
    }, 60_000)

    try {
      const interaction = await message.awaitMessageComponent({
        filter: (interaction) =>
          (dryRun || interaction.user.id === user.id) &&
          (interaction.customId === 'qotd_accept' || interaction.customId === 'qotd_pass'),
        time: 600_000,
        componentType: ComponentType.Button
      })

      clearInterval(reminderInterval)

      logger?.info(`[qotd] user ${interaction.user.username} responded with ${interaction.customId}`)

      if (interaction.customId === 'qotd_accept') {
        await interaction.update({
          content: `${mention} will do QOTD today!`,
          components: []
        })
        logger?.info('[qotd] flow complete, user accepted')
        return
      }

      await interaction.update({
        content: `${mention} passed. Moving to next person...`,
        components: []
      })
      logger?.info(`[qotd] user passed, moving to next`)
      currentIndex++
    } catch (error) {
      clearInterval(reminderInterval)
      logger?.warn(`[qotd] user ${user.user.username} did not respond or error occurred`, error)
      await message?.edit({
        content: `${mention} didn't respond. Moving to next person...`,
        components: []
      })
      currentIndex++
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  logger?.warn('[qotd] no one accepted QOTD')
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
        new SlashCommandSubcommandBuilder()
          .setName(QotdSubcommandTest)
          .setDescription('Test QOTD flow without pinging anyone')
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

    if (subcommand === QotdSubcommandTest) {
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

      await context.interaction.reply({ content: 'Starting QOTD test (no pings)...', flags: 64 })
      await runQotdFlow(channel as TextChannel, guild, true, context.logger)
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
    await runQotdFlow(channel as TextChannel, guild, false, context.logger)
  }
} satisfies DiscordCommandHandler
