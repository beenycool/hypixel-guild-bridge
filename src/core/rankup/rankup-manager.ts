import type { Logger } from 'log4js'

import type Application from '../../application'
import type { BridgeConfigurations } from '../discord/bridge-configurations'

import { ActionDispatcher } from './action-dispatcher.js'
import { BridgeEvaluator } from './bridge-evaluator.js'
import { NotificationManager } from './notification-manager.js'
import type { PendingReviewManager } from './pending-review-manager.js'
import { POLL_INTERVAL_MS, type RankupDecision } from './types.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ScheduleFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23'
})

export class RankupManager {
  private readonly bridgeEvaluator: BridgeEvaluator
  private readonly actionDispatcher: ActionDispatcher
  private readonly notificationManager: NotificationManager
  private readonly runningBridges = new Set<string>()
  private readonly lastRunByBridge = new Map<string, number>()
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
        if (!this.isDueForScheduleWindow(bridgeId)) {
          const day = this.bridgeConfig.getRankupScheduleDay(bridgeId)
          const hour = this.bridgeConfig.getRankupScheduleHour(bridgeId)
          this.logger.info(
            `Bridge ${bridgeId}: rankup checkup not due yet (schedule day ${day} hour ${hour} UK time), skipping scheduled checkup`
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

  private isDueForScheduleWindow(bridgeId: string): boolean {
    const day = this.bridgeConfig.getRankupScheduleDay(bridgeId)
    const hour = this.bridgeConfig.getRankupScheduleHour(bridgeId)
    if (day < 0 || hour < 0) return true

    const now = new Date()
    const parts = ScheduleFormatter.formatToParts(now)
    const weekday = parts.find((part) => part.type === 'weekday')?.value
    const currentHour = Number(parts.find((part) => part.type === 'hour')?.value)
    if (weekday !== WEEKDAYS[day] || currentHour !== hour) return false

    const windowStart = Math.floor(now.getTime() / 3_600_000) * 3_600_000
    return this.getLastRunAt(bridgeId) < windowStart
  }

  private getLastRunAt(bridgeId: string): number {
    const inMemory = this.lastRunByBridge.get(bridgeId)
    if (inMemory !== undefined) return inMemory

    const persisted = this.bridgeConfig.getRankupLastRunAt(bridgeId)
    return persisted > 0 ? persisted * 1000 : 0
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
      const now = Date.now()
      this.lastRunByBridge.set(bridgeId, now)
      this.bridgeConfig.setRankupLastRunAt(bridgeId, Math.floor(now / 1000))
    } catch (error) {
      this.logger.error(`Error in RankupManager task for bridge ${bridgeId}:`, error)
    } finally {
      this.runningBridges.delete(bridgeId)
    }
  }

  public async approveReview(bridgeId: string, id: number): Promise<void> {
    const review = this.pendingManager.getReview(bridgeId, id)
    if (review === undefined) {
      this.logger.warn(`approveReview: review %d not found for bridge %s`, id, bridgeId)
      return
    }
    if (review.bridgeId !== bridgeId) {
      this.logger.warn(`approveReview: review %d belongs to bridge %s, not %s; refusing`, id, review.bridgeId, bridgeId)
      return
    }

    const reviewBridgeId = review.bridgeId
    const instanceNames = this.bridgeConfig.getMinecraftInstances(reviewBridgeId)
    if (instanceNames.length === 0) {
      this.logger.warn(`approveReview: no Minecraft instances configured for bridge %s`, reviewBridgeId)
      return
    }

    const decision: RankupDecision & { kind: 'promote' | 'demote' | 'kick' } =
      review.action === 'kick'
        ? { kind: 'kick', uuid: review.uuid, currentRank: review.currentRank, reason: review.reason }
        : {
            kind: review.action,
            uuid: review.uuid,
            currentRank: review.currentRank,
            targetRank: review.proposedRank,
            reason: review.reason
          }

    await this.actionDispatcher.dispatch(reviewBridgeId, instanceNames[0], decision, review.currentRank)
    this.pendingManager.removeReview(reviewBridgeId, id)
  }

  public rejectReview(bridgeId: string, id: number, triggeredBy = 'web'): void {
    const review = this.pendingManager.getReview(bridgeId, id)
    if (review === undefined) {
      this.logger.warn(`rejectReview: review %d not found for bridge %s`, id, bridgeId)
      return
    }
    if (review.bridgeId !== bridgeId) {
      this.logger.warn(`rejectReview: review %d belongs to bridge %s, not %s; refusing`, id, review.bridgeId, bridgeId)
      return
    }

    this.pendingManager.logHistory(
      review.bridgeId,
      review.uuid,
      'reject',
      review.currentRank,
      review.proposedRank,
      triggeredBy
    )
    this.pendingManager.removeReview(review.bridgeId, id)
  }
}
