import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type { BridgeConfigurations } from '../discord/bridge-configurations.js'

import type { ActionDispatcher } from './action-dispatcher.js'
import { isNotificationDue } from './notification-cooldown.js'
import type { NotificationManager } from './notification-manager.js'
import type { PendingReviewManager } from './pending-review-manager.js'
import type { RankupDecision } from './rankup-decision.js'
import { RulesEvaluator } from './rules-evaluator.js'

export class BridgeEvaluator {
  constructor(
    private readonly application: Application,
    private readonly bridgeConfig: BridgeConfigurations,
    private readonly pendingManager: PendingReviewManager,
    private readonly notificationManager: NotificationManager,
    private readonly actionDispatcher: ActionDispatcher,
    private readonly logger: Logger
  ) {}

  async processBridge(bridgeId: string): Promise<void> {
    const instanceNames = this.bridgeConfig.getMinecraftInstances(bridgeId)

    if (instanceNames.length === 0) {
      this.logger.warn(`Bridge ${bridgeId}: no Minecraft instances configured, skipping checkup`)
      return
    }

    const minecraftInstance = this.application.minecraftManager
      .getAllInstances()
      .find((index) => index.instanceName === instanceNames[0])

    if (!minecraftInstance) {
      this.logger.warn(`No Minecraft instance "${instanceNames[0]}" found for bridge ${bridgeId}`)
      return
    }

    const botUuid = minecraftInstance.uuid()
    if (!botUuid) {
      this.logger.warn(`Minecraft instance "${instanceNames[0]}" is not connected for bridge ${bridgeId}`)
      return
    }

    const guild = await this.application.hypixelApi.getGuild('player', botUuid, {}).catch((error: unknown) => {
      this.logger.error(`Failed to fetch guild for bridge ${bridgeId} via bot ${botUuid}:`, error)
    })

    if (!guild) {
      this.logger.warn(`Bridge ${bridgeId}: guild not found or fetch failed, skipping checkup`)
      return
    }

    this.logger.info(`Bridge ${bridgeId}: fetched guild "${guild.name}" with ${guild.members.length} members`)

    const promotionRules = this.bridgeConfig.getRankupRules(bridgeId)
    const demotionRules = this.bridgeConfig.getRankupDemotionRules(bridgeId)
    const excludedRanks = this.bridgeConfig.getRankupExcludedRanks(bridgeId)
    const excludedPlayers = this.bridgeConfig.getRankupExcludedPlayers(bridgeId)
    const manualReview = this.bridgeConfig.getRankupManualReview(bridgeId)
    const officerChannels = this.bridgeConfig.getOfficerChannelIds(bridgeId)
    const configuredNotificationChannels = this.bridgeConfig.getRankupNotificationChannelIds(bridgeId)
    const notificationChannels = officerChannels.length > 0 ? officerChannels : configuredNotificationChannels
    const cooldownHours = this.bridgeConfig.getRankupNotificationCooldown(bridgeId)

    const rankPriority = guild.ranks.toSorted((a, b) => a.priority - b.priority).map((r) => r.name.toLowerCase())

    const evaluator = new RulesEvaluator()
    const currentGuildUuids = new Set<string>()

    const lastSeenRows = await this.application.core.databaseManager.queryRows<{
      memberUuid: string
      lastSeenAt: number
    }>('SELECT "memberUuid", "lastSeenAt" FROM "guildMemberStates" WHERE "instanceName" = $1', [instanceNames[0]])
    const lastSeenByUuid = new Map(lastSeenRows.map((row) => [row.memberUuid, row.lastSeenAt]))

    for (const member of guild.members) {
      currentGuildUuids.add(member.uuid)

      const inactiveEntry = this.application.core.inactivity.getActiveByUuid(member.uuid)
      if (inactiveEntry !== undefined) {
        this.pendingManager.removeReviewByUuid(bridgeId, member.uuid)
        continue
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Hypixel API may omit weeklyExperience at runtime despite the type
      const weeklyGexp = member.weeklyExperience ?? 0

      const memberLastSeen = lastSeenByUuid.get(member.uuid)
      const daysSinceLastSeen =
        memberLastSeen === undefined ? undefined : (Date.now() - memberLastSeen) / (1000 * 60 * 60 * 24)

      const stats = {
        uuid: member.uuid,
        rank: member.rank,
        joinedAt: member.joinedAt.getTime(),
        weeklyGexp,
        lastOnline: 0,
        daysSinceLastSeen
      }

      const result = evaluator.evaluate(
        stats,
        promotionRules,
        demotionRules,
        excludedRanks,
        excludedPlayers,
        rankPriority
      )

      if (result.action === 'none') {
        this.pendingManager.removeReviewByUuid(bridgeId, member.uuid)
        continue
      }

      if ((result.action === 'promote' || result.action === 'demote') && result.targetRank.length === 0) {
        this.logger.warn(`Skipping ${result.action} for ${member.uuid} in ${bridgeId}: missing target rank`)
        this.pendingManager.removeReviewByUuid(bridgeId, member.uuid)
        continue
      }

      let decision: RankupDecision

      switch (result.action) {
        case 'promote': {
          decision = {
            kind: 'promote',
            uuid: member.uuid,
            currentRank: member.rank,
            targetRank: result.targetRank,
            reason: result.reason
          }

          break
        }
        case 'demote': {
          decision = {
            kind: 'demote',
            uuid: member.uuid,
            currentRank: member.rank,
            targetRank: result.targetRank,
            reason: result.reason
          }

          break
        }
        case 'kick': {
          decision = { kind: 'kick', uuid: member.uuid, currentRank: member.rank, reason: result.reason }

          break
        }
        default: {
          decision = { kind: 'notify', uuid: member.uuid, currentRank: member.rank, reason: result.reason }
        }
      }

      if (manualReview && decision.kind !== 'notify') {
        if (decision.kind === 'kick') {
          this.pendingManager.addReview(bridgeId, decision.uuid, decision.currentRank, 'Kick', 'kick', decision.reason)
        } else {
          this.pendingManager.addReview(
            bridgeId,
            decision.uuid,
            decision.currentRank,
            decision.targetRank,
            decision.kind,
            decision.reason
          )
        }
      } else {
        if (decision.kind === 'promote' || decision.kind === 'demote' || decision.kind === 'kick') {
          this.actionDispatcher.dispatch(bridgeId, instanceNames[0], decision, member.rank).catch((error: unknown) => {
            this.logger.error(`Failed to dispatch ${decision.kind} for ${member.uuid} in ${bridgeId}:`, error)
          })
        } else {
          this.notificationManager.sendNotifyOnly(bridgeId, notificationChannels, decision).catch((error: unknown) => {
            this.logger.error(`Failed to send notify for ${member.uuid} in ${bridgeId}:`, error)
          })
        }
      }
    }

    this.logger.info(
      `Bridge ${bridgeId}: processed ${currentGuildUuids.size} guild members, ${this.pendingManager.getReviews(bridgeId).length} pending reviews`
    )

    this.pendingManager.clearReviewsNotInList(bridgeId, [...currentGuildUuids])

    const pending = this.pendingManager.getReviews(bridgeId)
    const cooldownMs = cooldownHours * 60 * 60 * 1000
    const now = Date.now()
    const unnotified = pending.filter((p) => isNotificationDue(p.notifiedAt, cooldownMs, now))

    if (unnotified.length > 0 && notificationChannels.length > 0) {
      const sent = await this.notificationManager.sendReviewNotification(bridgeId, notificationChannels, unnotified)

      if (sent) {
        for (const r of unnotified) {
          this.pendingManager.updateNotifiedAt(r.id)
        }
      }
    }
  }
}
