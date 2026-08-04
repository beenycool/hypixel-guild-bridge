import type { Logger } from 'log4js'

import type Application from '../../application'
import type { BridgeConfigurations } from '../discord/bridge-configurations'

import { ActionDispatcher } from './action-dispatcher.js'
import { BridgeEvaluator } from './bridge-evaluator.js'
import { POLL_INTERVAL_MS } from './constants.js'
import { NotificationManager } from './notification-manager.js'
import type { PendingReviewManager } from './pending-review-manager.js'
import type { RankupDecision } from './rankup-decision.js'

export class RankupManager {
  private readonly bridgeEvaluator: BridgeEvaluator
  private readonly actionDispatcher: ActionDispatcher
  private readonly notificationManager: NotificationManager
  private readonly runningBridges = new Set<string>()
  private isRunning = false

  constructor(
    private readonly application: Application,
    private readonly bridgeConfig: BridgeConfigurations,
    private readonly pendingManager: PendingReviewManager,
    private readonly logger: Logger
  ) {
    this.notificationManager = new NotificationManager(application)
    this.actionDispatcher = new ActionDispatcher(application, pendingManager, logger)
    this.bridgeEvaluator = new BridgeEvaluator(
      application,
      bridgeConfig,
      pendingManager,
      this.notificationManager,
      this.actionDispatcher,
      logger
    )

    setInterval(() => {
      this.runTask().catch((error: unknown) => {
        this.logger.error('Error in RankupManager scheduled task:', error)
      })
    }, POLL_INTERVAL_MS)
  }

  public async runTask(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    try {
      const bridgeIds = this.bridgeConfig.getAllBridgeIds()
      for (const bridgeId of bridgeIds) {
        if (!this.bridgeConfig.getRankupEnabled(bridgeId)) {
          this.logger.info(`Bridge ${bridgeId}: rankup disabled, skipping scheduled checkup`)
          continue
        }
        if (!this.isWithinScheduleWindow(bridgeId)) {
          const day = this.bridgeConfig.getRankupScheduleDay(bridgeId)
          const hour = this.bridgeConfig.getRankupScheduleHour(bridgeId)
          this.logger.info(
            `Bridge ${bridgeId}: outside rankup schedule (day ${day} hour ${hour} UK time), skipping scheduled checkup`
          )
          continue
        }
        await this.runTaskForBridge(bridgeId)
      }
    } catch (error) {
      this.logger.error('Error in RankupManager task:', error)
    } finally {
      this.isRunning = false
    }
  }

  private isWithinScheduleWindow(bridgeId: string): boolean {
    const day = this.bridgeConfig.getRankupScheduleDay(bridgeId)
    const hour = this.bridgeConfig.getRankupScheduleHour(bridgeId)
    if (day < 0 || hour < 0) return true

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23'
    }).formatToParts(new Date())
    const weekday = parts.find((part) => part.type === 'weekday')?.value
    const currentHour = Number(parts.find((part) => part.type === 'hour')?.value)
    if (weekday === undefined || Number.isNaN(currentHour)) return false

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return weekdays[day] === weekday && currentHour === hour
  }

  public async runTaskForBridge(bridgeId: string): Promise<void> {
    if (this.runningBridges.has(bridgeId)) return
    if (!this.bridgeConfig.getRankupEnabled(bridgeId)) {
      this.logger.warn(`Bridge ${bridgeId}: rankup disabled, runTaskForBridge skipped`)
      return
    }

    this.runningBridges.add(bridgeId)
    try {
      await this.bridgeEvaluator.processBridge(bridgeId)
    } catch (error) {
      this.logger.error(`Error in RankupManager task for bridge ${bridgeId}:`, error)
    } finally {
      this.runningBridges.delete(bridgeId)
    }
  }

  public async approveReview(bridgeId: string, id: number): Promise<void> {
    const review = this.pendingManager.getReview(id)
    if (review === undefined) {
      this.logger.warn(`approveReview: review %d not found for bridge %s`, id, bridgeId)
      return
    }

    const instanceNames = this.bridgeConfig.getMinecraftInstances(bridgeId)
    if (instanceNames.length === 0) {
      this.logger.warn(`approveReview: no Minecraft instances configured for bridge %s`, bridgeId)
      return
    }

    let decision: RankupDecision & { kind: 'promote' | 'demote' | 'kick' }
    decision =
      review.action === 'kick'
        ? { kind: 'kick', uuid: review.uuid, currentRank: review.currentRank, reason: review.reason }
        : {
            kind: review.action,
            uuid: review.uuid,
            currentRank: review.currentRank,
            targetRank: review.proposedRank,
            reason: review.reason
          }

    await this.actionDispatcher.dispatch(bridgeId, instanceNames[0], decision, review.currentRank)
    this.pendingManager.removeReview(id)
  }
}
