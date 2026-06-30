import type { Logger } from 'log4js'

import type Application from '../../application'
import type { BridgeConfigurations } from '../discord/bridge-configurations'

import { ActionDispatcher } from './action-dispatcher.js'
import { BridgeEvaluator } from './bridge-evaluator.js'
import { POLL_INTERVAL_MS } from './constants.js'
import { NotificationManager } from './notification-manager.js'
import type { PendingReviewManager } from './pending-review-manager.js'

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
        await this.runTaskForBridge(bridgeId)
      }
    } catch (error) {
      this.logger.error('Error in RankupManager task:', error)
    } finally {
      this.isRunning = false
    }
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
}
