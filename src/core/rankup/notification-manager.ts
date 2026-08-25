import { EmbedBuilder } from 'discord.js'
import type { Logger } from 'log4js'

import type Application from '../../application'

import type { PendingReview } from './pending-review-manager'

export class NotificationManager {
  private readonly logger: Logger

  constructor(private readonly application: Application) {
    this.logger = application.logger
  }

  public async sendReviewNotification(
    bridgeId: string,
    channelIds: string[],
    reviews: PendingReview[]
  ): Promise<boolean> {
    if (reviews.length === 0) return false

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
              .map((r) => `• <@${r.uuid}>: ${r.currentRank} ➜ ${r.proposedRank}`)
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

    const formatMemberLine = (review: PendingReview): string => {
      const name = uuidToName.get(review.uuid) ?? review.uuid
      const transition =
        review.action === 'kick' ? `${review.currentRank} ➜ **Kick**` : `${review.currentRank} ➜ ${review.proposedRank}`

      const details: string[] = []
      if (review.weeklyGexp !== undefined) {
        const formatted = review.weeklyGexp.toLocaleString('en-US')
        if (review.requiredGexp !== undefined && review.requiredGexp > 0) {
          const percent = Math.min(100, Math.round((review.weeklyGexp / review.requiredGexp) * 100))
          details.push(`Weekly GEXP: ${formatted} / ${review.requiredGexp.toLocaleString('en-US')} (${percent}%)`)
        } else {
          details.push(`Weekly GEXP: ${formatted}`)
        }
      }
      if (review.daysInGuild !== undefined) {
        details.push(`${review.daysInGuild.toFixed(0)} days in guild`)
      }
      if (review.daysSinceLastSeen !== undefined) {
        details.push(`last seen ${review.daysSinceLastSeen.toFixed(1)}d ago`)
      }

      const detailLine = details.length > 0 ? `\n   ${details.join(' • ')}` : ''
      return `• **${name}**: ${transition}${detailLine}`
    }

    const field1 =
      reviews
        .filter((r) => r.action === 'promote')
        .map((review) => formatMemberLine(review))
        .slice(0, 10)
        .join('\n') || 'None'

    const field2 =
      reviews
        .filter((r) => ['demote', 'kick'].includes(r.action))
        .map((review) => formatMemberLine(review))
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
