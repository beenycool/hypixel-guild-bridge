import assert from 'node:assert'

import type Application from '../application'
import { ChannelType, Color, GuildPlayerEventType, InstanceType } from '../common/application-event'
import { Status } from '../common/connectable-instance'
import { Instance } from '../common/instance'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'

export class RandomChatter extends Instance<InstanceType.Utility> {
  private readonly lastSentAt = new Map<string, number>()
  private readonly nextSendAt = new Map<string, number>()
  private readonly antiRepeatMemory = new Map<string, string[]>()
  private readonly lastActivityAt = new Map<string, number>()
  private started = false
  private intervalHandle: NodeJS.Timeout | undefined
  public pausedBy: string | undefined
  private readonly guildPlayerListener = (event: {
    type: GuildPlayerEventType
    user: { mojangProfile: () => { name: string } | undefined }
  }) => {
    if (this.pausedBy === undefined) return
    if (event.type !== GuildPlayerEventType.Offline) return

    const offlineName = event.user.mojangProfile()?.name
    if (offlineName !== undefined && offlineName.toLowerCase() === this.pausedBy.toLowerCase()) {
      this.logger.info(`random-chatter auto-resumed: ${this.pausedBy} logged out`)
      this.pausedBy = undefined
    }
  }

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

    this.application.addShutdownListener(() => {
      this.stop()
    })

    this.application.on('chat', (event) => {
      try {
        if (event.channelType !== ChannelType.Public) return

        const bId = event.bridgeId
        if (bId === undefined) {
          for (const id of this.application.core.bridgeConfigurations.getAllBridgeIds()) {
            this.lastActivityAt.set(id, event.createdAt)
          }
        } else {
          this.lastActivityAt.set(bId, event.createdAt)
        }
      } catch {}
    })

    this.application.on('guildPlayer', this.guildPlayerListener)

    this.application.on('bridgeConfigChanged', (event) => {
      try {
        if (
          (event.key === 'remove_bridge' || event.key.startsWith(`${event.bridgeId}_`)) &&
          !this.application.core.bridgeConfigurations.getAllBridgeIds().includes(event.bridgeId)
        ) {
          this.lastSentAt.delete(event.bridgeId)
          this.nextSendAt.delete(event.bridgeId)
          this.antiRepeatMemory.delete(event.bridgeId)
          this.lastActivityAt.delete(event.bridgeId)
        }
      } catch {}
    })
  }

  public stop(): void {
    if (!this.started) return
    this.started = false
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
    this.application.off('guildPlayer', this.guildPlayerListener)
  }

  private async maybeSendForBridge(bridgeId: string): Promise<void> {
    if (this.pausedBy !== undefined) return

    const bridgeConfig = this.application.core.bridgeConfigurations

    const enabled = bridgeConfig.getRandomChatterEnabled(bridgeId)
    if (!enabled) return

    const intervalMinutes = bridgeConfig.getRandomChatterIntervalMinutes(bridgeId)
    assert.ok(
      Number.isFinite(intervalMinutes) && intervalMinutes > 0,
      `invalid random chatter interval for bridge ${bridgeId}: ${String(intervalMinutes)}`
    )

    const now = Date.now()
    const next = this.nextSendAt.get(bridgeId)
    if (next !== undefined && now < next) return

    const messages = bridgeConfig.getRandomChatterMessages(bridgeId, [])
    if (messages.length === 0) return

    const minOnline = bridgeConfig.getRandomChatterMinimumOnlinePlayers(bridgeId)
    const includeName = bridgeConfig.getRandomChatterIncludePlayerName(bridgeId)

    const quietMinutes = bridgeConfig.getRandomChatterQuietWindowMinutes(bridgeId)
    if (quietMinutes > 0) {
      const lastActivity = this.lastActivityAt.get(bridgeId)
      if (lastActivity !== undefined && lastActivity + Duration.minutes(quietMinutes).toMilliseconds() > Date.now())
        return
    }

    const instanceNames = bridgeConfig.getMinecraftInstances(bridgeId)
    if (instanceNames.length === 0) return

    let chosenInstance: string | undefined
    const mcInstances = this.application.minecraftManager.getAllInstances()
    for (const instName of instanceNames) {
      const mcCandidate = mcInstances.find(
        (index) =>
          index.instanceName.toLowerCase() === instName.toLowerCase() && index.currentStatus() === Status.Connected
      )
      if (mcCandidate) {
        chosenInstance = mcCandidate.instanceName
        break
      }
    }
    if (!chosenInstance) return

    const mc = this.application.minecraftManager
      .getAllInstances()
      .find((index) => index.instanceName.toLowerCase() === chosenInstance.toLowerCase())
    if (mc === undefined) return

    const botIgn = mc.username()
    if (botIgn === undefined) {
      return
    }

    const guild = await this.application.core.guildManager.list(chosenInstance)
    const onlineMembers = guild.members.filter((m) => m.online)
    if (onlineMembers.length < minOnline) return

    const antiRepeatLength = bridgeConfig.getRandomChatterAntiRepeatLength(bridgeId)
    const memory = this.antiRepeatMemory.get(bridgeId) ?? []
    let candidates = messages.filter((m) => !memory.includes(m))
    if (candidates.length === 0) candidates = messages
    const raw = candidates[Math.floor(Math.random() * candidates.length)]
    let message = raw
    let pickedName: string | undefined
    if (includeName && raw.includes('{username}')) {
      pickedName = botIgn
      message = raw.replaceAll('{username}', pickedName)
    } else if (includeName) {
      pickedName = botIgn
      message = `${pickedName}: ${raw}`
    }

    if (message.length > 2000) {
      this.logger.warn(
        `random-chatter message too long for bridge ${bridgeId} (${message.length} chars). Truncating to 2000 chars.`
      )
      message = message.slice(0, 2000)
    }

    const skinUsername = botIgn
    const botRank = this.application.minecraftManager.getBotRank(chosenInstance)

    let imageBodyFormatted: string | undefined
    if (includeName && pickedName !== undefined && !raw.includes('{username}')) {
      const colon = message.indexOf(': ')
      if (colon !== -1 && message.slice(0, colon) === pickedName) {
        const namePart = botRank === undefined ? `§a${pickedName}§f` : `${botRank}§f`
        imageBodyFormatted = `${namePart}: §f${message.slice(colon + 2)}`
      }
    } else if (includeName && pickedName !== undefined && raw.includes('{username}')) {
      const namePart = botRank === undefined ? `§a${pickedName}§f` : `${botRank}§f`
      imageBodyFormatted = raw.replaceAll('{username}', namePart)
    }

    await this.application.emit('broadcast', {
      ...this.eventHelper.fillBaseEvent(),
      channels: [ChannelType.Public],
      color: Color.Default,
      user: undefined,
      message: message,
      bridgeId: bridgeId,
      guildChatImageStyle: {
        channelType: ChannelType.Public,
        skinUsername,
        ...(imageBodyFormatted === undefined ? {} : { imageBodyFormatted })
      }
    })

    if (antiRepeatLength > 0) {
      const nextMem = [...(this.antiRepeatMemory.get(bridgeId) ?? [])]
      nextMem.push(raw)
      while (nextMem.length > antiRepeatLength) nextMem.shift()
      this.antiRepeatMemory.set(bridgeId, nextMem)
    }

    this.lastSentAt.set(bridgeId, Date.now())
    const intervalMs = Duration.minutes(intervalMinutes).toMilliseconds()
    const jitterFactor = 0.8 + Math.random() * 0.4
    const jitteredIntervalMs = Math.round(intervalMs * jitterFactor)
    this.nextSendAt.set(bridgeId, Date.now() + jitteredIntervalMs)
  }

  public async sendTest(bridgeId: string): Promise<{ sent: boolean; message?: string; reason?: string }> {
    try {
      const bridgeConfig = this.application.core.bridgeConfigurations

      const enabled = bridgeConfig.getRandomChatterEnabled(bridgeId)
      if (!enabled) return { sent: false, reason: 'disabled' }

      if (this.pausedBy !== undefined) return { sent: false, reason: 'paused' }

      const messages = bridgeConfig.getRandomChatterMessages(bridgeId, [])
      if (messages.length === 0) return { sent: false, reason: 'no_messages' }

      const minOnline = bridgeConfig.getRandomChatterMinimumOnlinePlayers(bridgeId)
      const includeName = bridgeConfig.getRandomChatterIncludePlayerName(bridgeId)

      const instanceNames = bridgeConfig.getMinecraftInstances(bridgeId)
      if (instanceNames.length === 0) return { sent: false, reason: 'no_instances_configured' }

      let chosenInstance: string | undefined
      const mcInstances = this.application.minecraftManager.getAllInstances()
      for (const instName of instanceNames) {
        const mcCandidate = mcInstances.find(
          (index) =>
            index.instanceName.toLowerCase() === instName.toLowerCase() && index.currentStatus() === Status.Connected
        )
        if (mcCandidate) {
          chosenInstance = mcCandidate.instanceName
          break
        }
      }
      if (!chosenInstance) return { sent: false, reason: 'no_connected_instance' }

      const mc = this.application.minecraftManager
        .getAllInstances()
        .find((index) => index.instanceName.toLowerCase() === chosenInstance.toLowerCase())
      if (mc === undefined) return { sent: false, reason: 'instance_not_found' }

      const botIgn = mc.username()
      if (botIgn === undefined) return { sent: false, reason: 'bot_username_unavailable' }

      const guild = await this.application.core.guildManager.list(chosenInstance)
      const onlineMembers = guild.members.filter((m) => m.online)
      if (onlineMembers.length < minOnline) return { sent: false, reason: 'not_enough_players_online' }

      const raw = messages[Math.floor(Math.random() * messages.length)]
      let message = raw
      let pickedName: string | undefined
      if (includeName && raw.includes('{username}')) {
        pickedName = botIgn
        message = raw.replaceAll('{username}', pickedName)
      } else if (includeName) {
        pickedName = botIgn
        message = `${pickedName}: ${raw}`
      }

      if (message.length > 2000) message = message.slice(0, 2000)

      const skinUsername = botIgn
      const botRank = this.application.minecraftManager.getBotRank(chosenInstance)

      let imageBodyFormatted: string | undefined
      if (includeName && pickedName !== undefined && !raw.includes('{username}')) {
        const colon = message.indexOf(': ')
        if (colon !== -1 && message.slice(0, colon) === pickedName) {
          const namePart = botRank === undefined ? `§a${pickedName}§f` : `${botRank}§f`
          imageBodyFormatted = `${namePart}: §f${message.slice(colon + 2)}`
        }
      } else if (includeName && pickedName !== undefined && raw.includes('{username}')) {
        const namePart = botRank === undefined ? `§a${pickedName}§f` : `${botRank}§f`
        imageBodyFormatted = raw.replaceAll('{username}', namePart)
      }

      await this.application.emit('broadcast', {
        ...this.eventHelper.fillBaseEvent(),
        channels: [ChannelType.Public],
        color: Color.Default,
        user: undefined,
        message: message,
        bridgeId: bridgeId,
        guildChatImageStyle: {
          channelType: ChannelType.Public,
          skinUsername,
          ...(imageBodyFormatted === undefined ? {} : { imageBodyFormatted })
        }
      })

      this.lastSentAt.set(bridgeId, Date.now())
      return { sent: true, message }
    } catch (error: unknown) {
      return { sent: false, reason: String(error) }
    }
  }
}
