import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type Guild,
  type Message,
  type TextChannel
} from 'discord.js'
import type { Logger } from 'log4js'

const QotdUsers = ['fluffydeadmuffin', 'spleeney_', 'flqw3d'] as const

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
  let message: Message<true> | undefined

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
      await message.edit({
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
