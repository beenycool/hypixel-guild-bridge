import type { Logger } from 'log4js'

import type Application from '../../application.js'
import { MinecraftSendChatPriority } from '../../common/application-event.js'

import type { PendingReviewManager } from './pending-review-manager.js'
import type { RankupDecision } from './types.js'

export class ActionDispatcher {
  constructor(
    private readonly application: Application,
    private readonly pendingManager: PendingReviewManager,
    private readonly logger: Logger
  ) {}

  async dispatch(
    bridgeId: string,
    instanceName: string,
    decision: RankupDecision & { kind: 'promote' | 'demote' | 'kick' },
    fromRank: string
  ): Promise<void> {
    const uuid = decision.uuid
    const name = await this.application.mojangApi
      .profileByUuid(uuid)
      .then((p) => p.name)
      .catch(() => undefined)

    if (!name) {
      this.logger.error(`Failed to resolve Mojang username for ${uuid}. Aborting rankup action for bridge ${bridgeId}.`)
      this.pendingManager.logHistory(bridgeId, uuid, 'reject', fromRank, fromRank, 'System (API Error)')
      return
    }

    let command = ''
    let actionLog: 'promote' | 'demote' | 'kick' | 'reject' | 'manual_update' = 'promote'
    let toRank = ''

    if (decision.kind === 'kick') {
      command = `/g kick ${name} ${decision.reason}`
      actionLog = 'kick'
      toRank = 'Kick'
    } else {
      command = `/g setrank ${name} ${decision.targetRank}`
      actionLog = decision.kind
      toRank = decision.targetRank
    }

    const instance = this.application.minecraftManager
      .getAllInstances()
      .find((index) => index.instanceName.toLowerCase() === instanceName.toLowerCase())

    if (instance === undefined) {
      this.logger.warn(`Minecraft instance "${instanceName}" not found for bridge ${bridgeId}`)
      this.pendingManager.logHistory(bridgeId, uuid, 'reject', fromRank, toRank, 'System (Instance Not Found)')
      return
    }

    try {
      await instance.send(command, MinecraftSendChatPriority.High, undefined)
      this.pendingManager.logHistory(bridgeId, uuid, actionLog, fromRank, toRank, 'System')
    } catch (error: unknown) {
      this.logger.error(`Failed to send command ${command} for bridge ${bridgeId}:`, error)
      this.pendingManager.logHistory(bridgeId, uuid, 'reject', fromRank, toRank, 'System (Command Failed)')
    }
  }
}
