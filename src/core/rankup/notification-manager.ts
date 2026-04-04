import { EmbedBuilder } from 'discord.js'

import type Application from '../../application'
import type { PendingReview } from './pending-review-manager'

export class NotificationManager {
  constructor(private readonly application: Application) {}

  public async sendReviewNotification(
    bridgeId: string,
    channelIds: string[],
    reviews: PendingReview[]
  ): Promise<void> {
    if (reviews.length === 0) return

    // Sometimes bridgeId matches guildId, sometimes it's internal.
    // We iterate all instances and find the one that has these channels?
    // Actually, Application has instances map. But usually we need the Discord instance.
    // Let's assume we can get the Discord instance that "owns" these channels.
    // In the current architecture, we might just iterate all discord instances or use a helper.
    // For simplicity, let's try to find the channel in any active discord instance.

    const embed = new EmbedBuilder()
      .setTitle('📋 Rankup Reviews Pending')
      .setColor('#FFA500')
      .setDescription(`There are **${reviews.length}** members pending rankup review.`)
      .addFields(
        {
          name: 'Promotions',
          value:
            reviews
              .filter((r) => r.action === 'promote')
              .map((r) => `• <@${r.uuid}>: ${r.currentRank} ➜ ${r.proposedRank}`) // uuid here is MC UUID, need name resolve?
              .slice(0, 10)
              .join('\n') || 'None',
        },
        {
          name: 'Demotions/Kicks',
          value:
            reviews
              .filter((r) => ['demote', 'kick'].includes(r.action))
              .map((r) => `• <@${r.uuid}>: ${r.currentRank} ➜ ${r.proposedRank || 'Kick'}`)
              .slice(0, 10)
              .join('\n') || 'None',
        }
      )
      .setFooter({ text: 'Use /rankup-pending to view and act on these reviews.' })
      .setTimestamp()

    // Resolve UUIDs to names (best effort)
    const uuidToName = new Map<string, string>()
    for (const review of reviews) {
      if (!uuidToName.has(review.uuid)) {
        const name = await this.application.mojangApi.profileByUuid(review.uuid).then((p) => p.name).catch(() => review.uuid)
        uuidToName.set(review.uuid, name)
      }
    }

    // Rebuild fields with names
    const field1 = reviews
        .filter((r) => r.action === 'promote')
        .map((r) => `• **${uuidToName.get(r.uuid)}**: ${r.currentRank} ➜ ${r.proposedRank}`)
        .slice(0, 10)
        .join('\n') || 'None'
    
    const field2 = reviews
        .filter((r) => ['demote', 'kick'].includes(r.action))
        .map((r) => `• **${uuidToName.get(r.uuid)}**: ${r.currentRank} ➜ ${r.proposedRank || 'Kick'}`)
        .slice(0, 10)
        .join('\n') || 'None'

    embed.setFields(
        { name: 'Promotions', value: field1 },
        { name: 'Demotions/Kicks', value: field2 }
    )


    for (const channelId of channelIds) {
        // Broadcast to all connected discord instances that might have this channel
        const instance = this.application.discordInstance
        if (instance) {
            const channel = await (instance as any).client.channels.fetch(channelId).catch(() => null)
            if (channel && channel.isTextBased()) {
                await (channel as any).send({ embeds: [embed] }).catch(console.error)
            }
        }
    }
  }
}
