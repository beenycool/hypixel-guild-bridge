import type { APIEmbed } from 'discord.js'
import { escapeMarkdown, MessageFlags, SlashCommandBuilder } from 'discord.js'

import { Color, Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import type { MojangProfile } from '../../../common/user.js'
import type Duration from '../../../utility/duration.js'
import { getDuration } from '../../../utility/shared-utility.js'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('inactivity')
      .setDescription('Request an inactivity notice for the guild')
      .addStringOption((option) =>
        option.setName('time').setDescription('How long you will be inactive (e.g. 1d, 72h)').setRequired(true)
      )
      .addStringOption((option) => option.setName('reason').setDescription('Reason for inactivity').setRequired(false))
      .addStringOption((option) =>
        option
          .setName('username')
          .setDescription('Staff only: file the notice for this Minecraft player')
          .setRequired(false)
          .setAutocomplete(true)
      ),

  handler: async function (context) {
    const bridgeId = context.bridgeId
    if (bridgeId === undefined) {
      await context.interaction.reply({
        content: 'This command must be used in a configured bridge channel.',
        flags: MessageFlags.Ephemeral
      })
      return
    }

    await context.interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const cfg = context.application.core.bridgeConfigurations
    if (!cfg.getInactivityEnabled(bridgeId)) {
      await context.interaction.editReply('Inactivity requests are not enabled on this bridge.')
      return
    }

    const channelIds = cfg.getInactivityChannelIds(bridgeId)
    if (channelIds.length === 0) {
      await context.interaction.editReply('No inactivity channels are configured.')
      return
    }

    const targetUsername = context.interaction.options.getString('username')
    let uuid: string
    let profileName: string
    let discordId: string

    if (targetUsername === null) {
      const mojangProfile = context.user.mojangProfile()
      if (mojangProfile === undefined) {
        await context.interaction.editReply('You are not linked to a Minecraft account.')
        return
      }

      uuid = mojangProfile.id
      profileName = mojangProfile.name
      discordId = context.interaction.user.id
    } else {
      if (context.permission < Permission.Helper) {
        await context.interaction.editReply('You do not have permission to file inactivity for another player.')
        return
      }

      let profile: MojangProfile
      try {
        profile = await context.application.mojangApi.profileByUsername(targetUsername.trim())
      } catch {
        await context.interaction.editReply(
          `Could not resolve Minecraft username \`${escapeMarkdown(targetUsername)}\`.`
        )
        return
      }

      const link = await context.application.core.verification.findByIngame(profile.id)
      uuid = profile.id
      profileName = profile.name
      discordId = link?.discordId ?? ''
    }

    let duration: Duration
    try {
      duration = getDuration(context.interaction.options.getString('time', true).toLowerCase())
    } catch {
      await context.interaction.editReply('Please provide a valid time (e.g. 1d, 72h).')
      return
    }

    if (duration.toSeconds() <= 0) {
      await context.interaction.editReply('Please provide a time greater than 0.')
      return
    }

    const maxDays = cfg.getInactivityMaxDays(bridgeId)
    if (maxDays > 0 && duration.toDays() > maxDays) {
      await context.interaction.editReply(`You can only request inactivity for ${maxDays} day(s) or less.`)
      return
    }

    const inactivity = context.application.core.inactivity
    inactivity.purgeExpired()
    const existing = inactivity.getActive(bridgeId, uuid)
    if (existing !== undefined) {
      await context.interaction.editReply({
        embeds: [createExistingEmbed(profileName, existing.expiresAt, existing.reason)]
      })
      return
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const expiresAt = nowSeconds + Math.floor(duration.toSeconds())
    const reason = context.interaction.options.getString('reason') ?? 'None'
    const createdBy = context.interaction.user.id

    inactivity.add({
      bridgeId,
      uuid,
      discordId,
      createdBy,
      reason,
      expiresAt
    })

    const embed = createNoticeEmbed({
      uuid,
      profileName,
      reason,
      discordId,
      createdBy,
      requestedAt: nowSeconds,
      expiresAt
    })

    let sent = 0
    for (const channelId of channelIds) {
      try {
        const channel = await context.interaction.client.channels.fetch(channelId)
        if (channel?.isSendable() !== true) continue
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } })
        sent++
      } catch (error: unknown) {
        context.logger.error(`Failed to send inactivity notice to channel ${channelId}`, error)
      }
    }

    if (sent === 0) {
      inactivity.remove(bridgeId, uuid)
      await context.interaction.editReply('Failed to send the inactivity notice to the configured channels.')
      return
    }

    await (targetUsername === null
      ? context.interaction.editReply('Your inactivity notice has been sent to the guild staff.')
      : context.interaction.editReply(
          `Inactivity notice for ${escapeMarkdown(profileName)} has been sent to the guild staff.`
        ))
  },

  autoComplete: async function (context) {
    const option = context.interaction.options.getFocused(true)
    if (option.name === 'username') {
      const completedUsernames = await context.application.core.completeUsername(option.value, 25)
      const response = completedUsernames.map((choice) => ({
        name: choice,
        value: choice
      }))
      await context.interaction.respond(response)
    }
  }
} satisfies DiscordCommandHandler

function createExistingEmbed(profileName: string, expiresAt: number, reason: string): APIEmbed {
  return {
    color: Color.Info,
    title: 'Inactivity Notice',
    description:
      `${escapeMarkdown(profileName)} is already inactive until <t:${expiresAt}:F> (<t:${expiresAt}:R>).\n` +
      `Reason: ${escapeMarkdown(reason)}`
  }
}

function createNoticeEmbed(data: {
  uuid: string
  profileName: string
  reason: string
  discordId: string
  createdBy: string
  requestedAt: number
  expiresAt: number
}): APIEmbed {
  const lines = [
    `**${escapeMarkdown(data.profileName)} is inactive** until <t:${data.expiresAt}:F> (<t:${data.expiresAt}:R>)`,
    `Reason: ${escapeMarkdown(data.reason)}`
  ]

  if (data.createdBy !== data.discordId) {
    lines.push(`Filed by: <@${data.createdBy}>`)
  }
  if (data.discordId !== '') {
    lines.push(`Member: <@${data.discordId}>`)
  }
  lines.push(`Requested: <t:${data.requestedAt}:F>`)

  return {
    color: Color.Default,
    title: 'Inactivity Notice',
    description: lines.join('\n'),
    thumbnail: {
      url: `https://www.mc-heads.net/avatar/${data.uuid}`
    }
  }
}
