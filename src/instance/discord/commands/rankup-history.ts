import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands'
import { Permission } from '../../../common/application-event'
import { PendingReviewManager } from '../../../core/rankup/pending-review-manager'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('rankup-history')
      .setDescription('View rankup history'),
  permission: Permission.Officer,
  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { application, interaction, bridgeId } = context

    await interaction.deferReply()

    if (!bridgeId) {
        await interaction.editReply('This command must be run in a bridge context.')
        return
    }

    const pendingManager = new PendingReviewManager(application.core.sqliteManager.getDatabase())
    const history = pendingManager.getHistory(bridgeId, 20) // Get last 20 entries

    if (history.length === 0) {
      await interaction.editReply('No history found.')
      return
    }

    const uuidToName = new Map<string, string>()
    for (const h of history) {
      if (!uuidToName.has(h.uuid)) {
        const name = await application.mojangApi.profileByUuid(h.uuid).then(p => p.name).catch(() => h.uuid.slice(0, 8))
        uuidToName.set(h.uuid, name)
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Rankup History (Last 20)')
      .setColor('#0099FF')
      .setDescription(
        history.map(h => {
            const name = uuidToName.get(h.uuid)
            const time = `<t:${Math.floor(h.createdAt / 1000)}:R>`
            return `**${h.action.toUpperCase()}**: ${name} (${h.fromRank} -> ${h.toRank}) by ${h.triggeredBy} ${time}`
        }).join('\n')
      )

    await interaction.editReply({ embeds: [embed] })
  }
} satisfies DiscordCommandHandler
