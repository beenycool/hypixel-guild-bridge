import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'

const QotdUsers = ['fluffydeadmuffin', 'spleeney_', 'flqw3d'] as const

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('qotd').setDescription('Assign Question of the Day to someone'),
  permission: Permission.Helper,

  handler: async function (context) {
    await context.interaction.deferReply()

    const guild = context.interaction.guild
    if (!guild) {
      await context.interaction.editReply('This command can only be used in a server.')
      return
    }

    const members = QotdUsers.map((name) => guild.members.cache.find((member) => member.user.username === name)).filter(
      (member): member is NonNullable<typeof member> => member !== undefined
    )

    if (members.length === 0) {
      await context.interaction.editReply('None of the QOTD members were found in this guild.')
      return
    }

    let currentIndex = 0
    let message = await context.interaction.fetchReply()

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

      message = await context.interaction.editReply({
        content: `<@${user.id}> it's your turn to ask the Question of the Day!`,
        components: [row]
      })

      let reminderCount = 0
      const reminderInterval = setInterval(() => {
        reminderCount++
        if (reminderCount <= 9) {
          message.reply(`⏰ Reminder: <@${user.id}> please respond to the QOTD request!`).catch(() => undefined)
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
        await context.interaction.editReply({
          content: `<@${user.id}> didn't respond. Moving to next person...`,
          components: []
        })
        currentIndex++
      }

      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    await context.interaction.editReply({
      content: '❌ No one is available for QOTD today!',
      components: []
    })
  }
} satisfies DiscordCommandHandler
