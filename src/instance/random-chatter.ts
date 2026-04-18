import assert from 'node:assert'

import type Application from '../application'
import { ChannelType, Color, InstanceType } from '../common/application-event'
import { Instance } from '../common/instance'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'

export class RandomChatter extends Instance<InstanceType.Utility> {
  private readonly lastSentAt = new Map<string, number>()
  private started = false
  private intervalHandle: NodeJS.Timeout | undefined

  constructor(application: Application) {
    super(application, 'random-chatter', InstanceType.Utility)
  }

  public start(): void {
    if (this.started) return
    this.started = true
    this.intervalHandle = setIntervalAsync(
      async () => {
        try {
          const bridgeConfig = this.application.core.bridgeConfigurations

          const bridgeIds = bridgeConfig.getAllBridgeIds()
          for (const bridgeId of bridgeIds) {
            try {
              await this.maybeSendForBridge(bridgeId)
            } catch (error: unknown) {
              this.logger.warn(`random-chatter failed for bridge ${bridgeId}`, error)
            }
          }
        } catch (error: unknown) {
          this.logger.warn('random-chatter periodic check failed', error)
        }
      },
      { errorHandler: this.errorHandler.promiseCatch('random chatter check'), delay: Duration.minutes(1) }
    )

    this.application.addShutdownListener(() => this.stop())
    // Listen for bridge removals to cleanup lastSentAt map
    this.application.on('bridgeConfigChanged', (event) => {
      try {
        // When a bridge is removed, BridgeConfigurations.removeBridgeId deletes its keys.
        // We receive bridgeConfigChanged events for other changes as well; only act when bridgeId matches and key indicates removal.
        if (event.key === 'remove_bridge' || event.key.startsWith(`${event.bridgeId}_`)) {
          // If the bridge was removed (no longer present in list), clear memory for it
          if (!this.application.core.bridgeConfigurations.getAllBridgeIds().includes(event.bridgeId)) {
            this.lastSentAt.delete(event.bridgeId)
          }
        }
      } catch (e) {
        // swallow errors from cleanup
      }
    })
  }

  public stop(): void {
    if (!this.started) return
    this.started = false
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
  }

  private async maybeSendForBridge(bridgeId: string): Promise<void> {
    const bridgeConfig = this.application.core.bridgeConfigurations

    const enabled = bridgeConfig.getRandomChatterEnabled(bridgeId)
    if (!enabled) return

    const intervalMinutes = bridgeConfig.getRandomChatterIntervalMinutes(bridgeId)
    assert.ok(
      Number.isFinite(intervalMinutes) && intervalMinutes > 0,
      `invalid random chatter interval for bridge ${bridgeId}: ${String(intervalMinutes)}`
    )

    const now = Date.now()
    const last = this.lastSentAt.get(bridgeId) ?? 0
    if (last + Duration.minutes(intervalMinutes).toMilliseconds() > now) return

    const messages = bridgeConfig.getRandomChatterMessages(bridgeId, [])
    if (!messages || messages.length === 0) return

    const minOnline = bridgeConfig.getRandomChatterMinimumOnlinePlayers(bridgeId)
    const includeName = bridgeConfig.getRandomChatterIncludePlayerName(bridgeId)

    // Get guild list from guildManager for this bridge's configured minecraft instances.
    const instanceNames = bridgeConfig.getMinecraftInstances(bridgeId)
    if (!instanceNames || instanceNames.length === 0) return

    // Use the first available instance that is connected
    let chosenInstance: string | undefined
    const availableInstances = this.application.getInstancesNames(InstanceType.Minecraft)
    for (const inst of instanceNames) {
      if (availableInstances.includes(inst)) {
        chosenInstance = inst
        break
      }
    }
    if (!chosenInstance) return

    const guild = await this.application.core.guildManager.list(chosenInstance)
    const onlineMembers = guild.members.filter((m) => m.online)
    if (onlineMembers.length < minOnline) return

    // pick a message; with includeName, replace {username} or prefix "Name: " like bridged guild chat
    const raw = messages[Math.floor(Math.random() * messages.length)]
    let message = raw
    if (includeName && raw.includes('{username}')) {
      const name = onlineMembers[Math.floor(Math.random() * onlineMembers.length)].username
      message = raw.replaceAll('{username}', name)
    } else if (includeName) {
      const name = onlineMembers[Math.floor(Math.random() * onlineMembers.length)].username
      message = `${name}: ${raw}`
    }

    // Ensure message length is acceptable for Discord
    if (message.length > 2000) {
      this.logger.warn(
        `random-chatter message too long for bridge ${bridgeId} (${message.length} chars). Truncating to 2000 chars.`
      )
      message = message.slice(0, 2000)
    }

    await this.application.emit('broadcast', {
      ...this.eventHelper.fillBaseEvent(),
      channels: [ChannelType.Public],
      color: Color.Info,
      user: undefined,
      message: message,
      bridgeId: bridgeId
    })

    this.lastSentAt.set(bridgeId, Date.now())
  }
}
