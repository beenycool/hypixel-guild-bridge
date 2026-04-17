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
<<<<<<< HEAD
    this.intervalHandle = setIntervalAsync(
      async () => {
=======

    this.intervalHandle = setInterval(() => {
      void (async () => {
>>>>>>> 873b12d (feat(random-chatter): add RandomChatter utility and per-bridge settings)
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
<<<<<<< HEAD
      },
      { errorHandler: this.errorHandler.promiseCatch('random chatter check'), delay: Duration.minutes(1) }
    )
=======
      })().catch(this.errorHandler.promiseCatch('random chatter check'))
    }, Duration.minutes(1).toMilliseconds())
>>>>>>> 873b12d (feat(random-chatter): add RandomChatter utility and per-bridge settings)

    this.application.addShutdownListener(() => this.stop())
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
<<<<<<< HEAD
    assert.ok(
      Number.isFinite(intervalMinutes) && intervalMinutes > 0,
      `invalid random chatter interval for bridge ${bridgeId}: ${String(intervalMinutes)}`
    )
=======
    assert.ok(Number.isFinite(intervalMinutes) && intervalMinutes >= 0)
>>>>>>> 873b12d (feat(random-chatter): add RandomChatter utility and per-bridge settings)

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

    // pick a message and replace {username} if requested
    const raw = messages[Math.floor(Math.random() * messages.length)]
    let message = raw
    if (includeName && raw.includes('{username}')) {
      const name = onlineMembers[Math.floor(Math.random() * onlineMembers.length)].username
      message = raw.replaceAll('{username}', name)
    }

<<<<<<< HEAD
    // Ensure message length is acceptable for Discord
    if (message.length > 2000) {
      this.logger.warn(
        `random-chatter message too long for bridge ${bridgeId} (${message.length} chars). Truncating to 2000 chars.`
      )
      message = message.slice(0, 2000)
    }

=======
>>>>>>> 873b12d (feat(random-chatter): add RandomChatter utility and per-bridge settings)
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
