import {
  type Guild,
  type GuildMember,
  type Message,
  type MessageReaction,
  type TextChannel,
  type User
} from 'discord.js'
import type { Logger } from 'log4js'

const QotdUserIds = ['878335694295171094', '1173245594752536726', '623714295838015509'] as const

export async function runQotdFlow(channel: TextChannel, guild: Guild, dryRun = false, logger?: Logger): Promise<void> {
  const members: GuildMember[] = []
  for (const id of QotdUserIds) {
    try {
      const member = await guild.members.fetch(id)
      members.push(member)
      logger?.info(`[qotd] user id ${id} found as ${member.user.username}`)
    } catch {
      logger?.warn(`[qotd] user id ${id} NOT found in guild`)
    }
  }

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

    const prefix = dryRun ? '[TEST] ' : ''
    message = await channel.send({
      content: `${prefix}${mention} it's your turn to ask the Question of the Day!`
    })

    await message.react('✅')
    await message.react('❌')

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
      const reaction = await new Promise<MessageReaction | null>((resolve) => {
        const collector = message!.createReactionCollector({
          filter: (reaction: MessageReaction, reactor: User) =>
            (dryRun || reactor.id === user.id) && (reaction.emoji.name === '✅' || reaction.emoji.name === '❌'),
          time: 600_000,
          max: 1
        })
        collector.on('end', (collected) => resolve(collected.first() ?? null))
      })

      clearInterval(reminderInterval)
      await message.reactions.removeAll().catch(() => undefined)

      if (reaction === null) {
        logger?.warn(`[qotd] user ${user.user.username} did not respond`)
        await message.edit({
          content: `${mention} didn't respond. Moving to next person...`
        })
        currentIndex++
      } else if (reaction.emoji.name === '✅') {
        logger?.info(`[qotd] user ${user.user.username} accepted`)
        await message.edit({
          content: `${mention} will do QOTD today!`
        })
        logger?.info('[qotd] flow complete, user accepted')
        return
      } else {
        logger?.info(`[qotd] user ${user.user.username} passed`)
        await message.edit({
          content: `${mention} passed. Moving to next person...`
        })
        currentIndex++
      }
    } catch (error) {
      clearInterval(reminderInterval)
      await message.reactions.removeAll().catch(() => undefined)
      logger?.warn(`[qotd] user ${user.user.username} did not respond or error occurred`, error)
      await message.edit({
        content: `${mention} didn't respond. Moving to next person...`
      })
      currentIndex++
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  logger?.warn('[qotd] no one accepted QOTD')
  await message?.edit({
    content: '❌ No one is available for QOTD today!'
  })
}
