import type { Logger } from 'log4js'

import type Application from '../../application'
import { MinecraftSendChatPriority } from '../../common/application-event'
import type { BridgeConfigurations } from '../discord/bridge-configurations'

import { NotificationManager } from './notification-manager'
import type { PendingReviewManager } from './pending-review-manager'
import { RulesEvaluator } from './rules-evaluator'

export class RankupManager {
  private readonly rulesEvaluator: RulesEvaluator

  private readonly notificationManager: NotificationManager

  private isRunning = false

  constructor(
    private readonly application: Application,

    private readonly bridgeConfig: BridgeConfigurations,

    private readonly pendingManager: PendingReviewManager,

    private readonly logger: Logger
  ) {
    this.rulesEvaluator = new RulesEvaluator()

    this.notificationManager = new NotificationManager(application)

    // Run every hour

    setInterval(
      () => {
        this.runTask().catch((error: unknown) => {
          this.logger.error('Error in RankupManager scheduled task:', error)
        })
      },
      60 * 60 * 1000
    )
  }

  public async runTask(): Promise<void> {
    if (this.isRunning) return

    this.isRunning = true

    try {
      const bridgeIds = this.bridgeConfig.getAllBridgeIds()

      for (const bridgeId of bridgeIds) {
        if (!this.bridgeConfig.getRankupEnabled(bridgeId)) continue

        await this.processBridge(bridgeId)
      }
    } catch (error) {
      this.logger.error('Error in RankupManager task:', error)
    } finally {
      this.isRunning = false
    }
  }

  public async runTaskForBridge(bridgeId: string): Promise<void> {
    if (this.isRunning) return

    if (!this.bridgeConfig.getRankupEnabled(bridgeId)) return

    this.isRunning = true

    try {
      await this.processBridge(bridgeId)
    } catch (error) {
      this.logger.error(`Error in RankupManager task for bridge ${bridgeId}:`, error)
    } finally {
      this.isRunning = false
    }
  }

  private async processBridge(bridgeId: string): Promise<void> {
    const instances = this.bridgeConfig.getMinecraftInstances(bridgeId)

    if (instances.length === 0) return

    // Pick the first configured instance to fetch guild data

    const botName = instances[0]

    const guild = await this.application.hypixelApi.getGuild('player', botName, {}).catch((error: unknown) => {
      this.logger.error(`Failed to fetch guild for bridge ${bridgeId} via bot ${botName}:`, error)
    })

    if (!guild) return

    const promotionRules = this.bridgeConfig.getRankupRules(bridgeId)

    const demotionRules = this.bridgeConfig.getRankupDemotionRules(bridgeId)

    const excludedRanks = this.bridgeConfig.getRankupExcludedRanks(bridgeId)

    const excludedPlayers = this.bridgeConfig.getRankupExcludedPlayers(bridgeId)

    const manualReview = this.bridgeConfig.getRankupManualReview(bridgeId)

    // Hypixel Guild Ranks are ordered by priority

    const rankPriority = guild.ranks.toSorted((a, b) => a.priority - b.priority).map((r) => r.name.toLowerCase())

    const currentGuildUuids = new Set<string>()

    for (const member of guild.members) {
      currentGuildUuids.add(member.uuid)

      const expHistoryValues = Object.values(member.expHistory)

      let weeklyGexp = 0
      for (const value of expHistoryValues) {
        const expValue = typeof value === 'number' ? value : ((value as { exp?: number }).exp ?? 0)
        weeklyGexp += expValue
      }

      const stats = {
        uuid: member.uuid,

        rank: member.rank,

        joinedAt: member.joinedAt.getTime(),

        weeklyGexp,

        lastOnline: 0 // Not reliably available without more complex tracking
      }

      const result = this.rulesEvaluator.evaluate(
        stats,

        promotionRules,

        demotionRules,

        excludedRanks,

        excludedPlayers,

        rankPriority
      )

      if (result.action === 'none') {
        // Clear stale review if player no longer qualifies for any action
        this.pendingManager.removeReviewByUuid(bridgeId, member.uuid)
      } else {
        if (
          (result.action === 'promote' || result.action === 'demote') &&
          (result.targetRank === undefined || result.targetRank.length === 0)
        ) {
          this.logger.warn(`Skipping ${result.action} for ${member.uuid} in ${bridgeId}: missing target rank`)
          this.pendingManager.removeReviewByUuid(bridgeId, member.uuid)
          continue
        }

        if (manualReview) {
          this.pendingManager.addReview(
            bridgeId,

            member.uuid,

            member.rank,

            result.action === 'kick' ? 'Kick' : (result.targetRank ?? 'Unknown'),

            result.action,

            result.reason ?? 'Automated rule match'
          )
        } else {
          await this.executeAction(bridgeId, botName, member.uuid, result)
        }
      }
    }

    // Clear pending reviews for players no longer in the guild
    this.pendingManager.clearReviewsNotInList(bridgeId, [...currentGuildUuids])

    // Notifications

    const pending = this.pendingManager.getReviews(bridgeId)

    const notificationChannels = this.bridgeConfig.getRankupNotificationChannelIds(bridgeId)

    const cooldownHours = this.bridgeConfig.getRankupNotificationCooldown(bridgeId)

    const cooldownMs = cooldownHours * 60 * 60 * 1000

    const now = Date.now()

    const unnotified = pending.filter((p) => {
      if (!p.notifiedAt) return true
      // Respect cooldown - only re-notify if cooldown has passed
      return now - p.notifiedAt * 1000 > cooldownMs
    })

    if (unnotified.length > 0 && notificationChannels.length > 0) {
      await this.notificationManager.sendReviewNotification(bridgeId, notificationChannels, unnotified)

      // Update notifiedAt only for the reviews that were just notified

      for (const r of unnotified) {
        this.pendingManager.updateNotifiedAt(r.id)
      }
    }
  }

  private async executeAction(
    bridgeId: string,
    instanceName: string,
    uuid: string,
    result: { action: string; targetRank?: string; reason?: string }
  ) {
    // Fetch player name

    const name = await this.application.mojangApi
      .profileByUuid(uuid)
      .then((p) => p.name)
      .catch(() => uuid)

    let command = ''

    let actionLog = ''

    if (result.action === 'promote' || result.action === 'demote') {
      if (result.targetRank === undefined || result.targetRank.length === 0) {
        this.logger.warn(`Cannot execute ${result.action} for ${uuid}: missing target rank`)
        return
      }

      command = `/g setrank ${name} ${result.targetRank}`
      actionLog = 'promote'
      if (result.action === 'demote') {
        actionLog = 'demote'
      }
    } else if (result.action === 'kick') {
      command = `/g kick ${name} ${result.reason}`

      actionLog = 'kick'
    }

    if (command) {
      const instance = this.application.minecraftManager
        .getAllInstances()
        .find((index) => index.instanceName.toLowerCase() === instanceName.toLowerCase())

      if (instance) {
        instance.send(command, MinecraftSendChatPriority.High, undefined).catch((error: unknown) => {
          this.logger.error(`Failed to send command ${command} for bridge ${bridgeId}:`, error)
        })

        this.pendingManager.logHistory(
          bridgeId,

          uuid,

          actionLog as 'demote' | 'kick' | 'promote' | 'reject' | 'manual_update',

          '?', // we'd need current rank here, but we can pass it or ignore

          result.targetRank ?? 'None',

          'System'
        )
      }
    }
  }
}
