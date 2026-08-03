import { EmbedBuilder } from 'discord.js'
import type { Logger } from 'log4js'

import type Application from '../../application'

import type { PendingReview } from './pending-review-manager'

export class NotificationManager {
  private readonly logger: Logger

  constructor(private readonly application: Application) {
    // Application.logger is now public; use it for logging
    this.logger = application.logger
  }

  public async sendReviewNotification(
    bridgeId: string,
    channelIds: string[],
    reviews: PendingReview[]
  ): Promise<boolean> {
    if (reviews.length === 0) return false

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
              .join('\n') || 'None'
        },
        {
          name: 'Demotions/Kicks',
          value:
            reviews
              .filter((r) => ['demote', 'kick'].includes(r.action))
              .map((r) => `• <@${r.uuid}>: ${r.currentRank} ➜ ${r.proposedRank || 'Kick'}`)
              .slice(0, 10)
              .join('\n') || 'None'
        }
      )
      .setFooter({ text: 'Review pending rankup changes via the web dashboard.' })
      .setTimestamp()

    // Resolve UUIDs to names (best effort)
    const uuidToName = new Map<string, string>()
    for (const review of reviews) {
      if (!uuidToName.has(review.uuid)) {
        const name = await this.application.mojangApi
          .profileByUuid(review.uuid)
          .then((p) => p.name)
          .catch(() => review.uuid)
        uuidToName.set(review.uuid, name)
      }
    }

    // Rebuild fields with names
    const field1 =
      reviews
        .filter((r) => r.action === 'promote')
        .map((r) => `• **${uuidToName.get(r.uuid)}**: ${r.currentRank} ➜ ${r.proposedRank}`)
        .slice(0, 10)
        .join('\n') || 'None'

    const field2 =
      reviews
        .filter((r) => ['demote', 'kick'].includes(r.action))
        .map((r) => `• **${uuidToName.get(r.uuid)}**: ${r.currentRank} ➜ ${r.proposedRank || 'Kick'}`)
        .slice(0, 10)
        .join('\n') || 'None'

    embed.setFields({ name: 'Promotions', value: field1 }, { name: 'Demotions/Kicks', value: field2 })

    let allSent = true
    for (const channelId of channelIds) {
      const instance = this.application.discordInstance
      const client = instance.getClient()
      const channel = await client.channels.fetch(channelId).catch(() => undefined)
      if (channel?.isSendable()) {
        try {
          await channel.send({ embeds: [embed] })
        } catch (error: unknown) {
          allSent = false
          this.logger.error(
            `Failed to send rankup review notification to channel ${channelId} for bridge ${bridgeId}:`,
            error
          )
        }
      } else {
        allSent = false
        this.logger.warn(
          `Rankup review notification channel ${channelId} for bridge ${bridgeId} not found or not sendable`
        )
      }
    }
    return allSent
  }

  public async sendNotifyOnly(
    bridgeId: string,
    channelIds: string[],
    decision: { uuid: string; currentRank: string; reason: string }
  ): Promise<void> {
    const name = await this.application.mojangApi
      .profileByUuid(decision.uuid)
      .then((p) => p.name)
      .catch(() => decision.uuid)

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Rankup Notification')
      .setColor('#FFA500')
      .setDescription(`**${name}** has triggered a notification-only demotion rule.`)
      .addFields(
        { name: 'Player', value: name, inline: true },
        { name: 'Current Rank', value: decision.currentRank, inline: true },
        { name: 'Reason', value: decision.reason }
      )
      .setTimestamp()

    for (const channelId of channelIds) {
      const instance = this.application.discordInstance
      const client = instance.getClient()
      const channel = await client.channels.fetch(channelId).catch(() => undefined)
      if (channel?.isSendable()) {
        try {
          await channel.send({ embeds: [embed] })
        } catch (error: unknown) {
          this.logger.error(
            `Failed to send rankup notify-only message to channel ${channelId} for bridge ${bridgeId}:`,
            error
          )
        }
      } else {
        this.logger.warn(`Rankup notify-only channel ${channelId} for bridge ${bridgeId} not found or not sendable`)
      }
    }
  }
}
