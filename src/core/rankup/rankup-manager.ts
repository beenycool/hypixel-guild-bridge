import type { Logger } from 'log4js'

import type Application from '../../application'
import type { BridgeConfigurations } from '../discord/bridge-configurations'

import { ActionDispatcher } from './action-dispatcher.js'
import { BridgeEvaluator } from './bridge-evaluator.js'
import { POLL_INTERVAL_MS } from './constants.js'
import { NotificationManager } from './notification-manager.js'
import type { PendingReviewManager } from './pending-review-manager.js'
import type { RankupDecision } from './rankup-decision.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

    for (const bridgeId of bridgeConfig.getAllBridgeIds()) {
      this.lastRunByBridge.set(bridgeId, bridgeConfig.getRankupLastRunAt(bridgeId))
    }

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

  /**
   * A scheduled bridge is due when the configured window (day/hour UK time) has started and no
   * checkup has run since the most recent occurrence of that window. This catches up automatically:
   * if the process was down or an hourly tick was missed when the window passed, the next tick
   * still runs the checkup instead of waiting a full week.
   */
  private isDueForScheduleWindow(bridgeId: string): boolean {
    const day = this.bridgeConfig.getRankupScheduleDay(bridgeId)
    const hour = this.bridgeConfig.getRankupScheduleHour(bridgeId)
    if (day < 0 || hour < 0) return true

    const scheduledTs = this.lastScheduledOccurrence(WEEKDAYS[day], hour, new Date())
    if (scheduledTs === undefined) return true

    return Date.now() >= scheduledTs && (this.lastRunByBridge.get(bridgeId) ?? 0) < scheduledTs
  }

  /**
   * Finds the timestamp of the most recent occurrence of the given UK weekday/hour (e.g. "Sun 19:00").
   * Scans back up to 8 days in 15-minute steps so DST transitions cannot cause a missed window.
   */
  private lastScheduledOccurrence(weekdayShort: string, hour: number, now: Date): number | undefined {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23'
    })
    const start = Math.floor(now.getTime() / 3_600_000) * 3_600_000
    for (let ts = start; ts > start - 8 * 86_400_000; ts -= 15 * 60_000) {
      const parts = formatter.formatToParts(new Date(ts))
      const weekday = parts.find((part) => part.type === 'weekday')?.value
      const partHour = Number(parts.find((part) => part.type === 'hour')?.value)
      const minute = Number(parts.find((part) => part.type === 'minute')?.value)
      if (weekday === weekdayShort && partHour === hour && minute === 0) return ts
    }
    return undefined
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

    await this.actionDispatcher.dispatch(bridgeId, instanceNames[0], decision, review.currentRank)
    this.pendingManager.removeReview(id)
  }
}
