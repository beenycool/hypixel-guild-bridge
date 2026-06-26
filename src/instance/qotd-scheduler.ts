import type { TextChannel } from 'discord.js'

import type Application from '../application'
import { CommandConfigManager } from '../common/command-config-manager'
import { InstanceType } from '../common/application-event'
import { Instance } from '../common/instance'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'
import { runQotdFlow } from './discord/commands/qotd'

const QotdCommandName = 'qotd'

function isQotdEnabled(application: Application): boolean {
  const configManager = new CommandConfigManager(application)
  return configManager.isCommandEnabled('discord', QotdCommandName)
}

export class QotdScheduler extends Instance<InstanceType.Utility> {
  private started = false
  private intervalHandle: NodeJS.Timeout | undefined
  private lastTriggeredDay = -1

  constructor(application: Application) {
    super(application, 'qotd-scheduler', InstanceType.Utility)
  }

  public start(): void {
    if (this.started) return
    this.started = true

    this.intervalHandle = setIntervalAsync(
      async () => {
        try {
          await this.checkAndTrigger()
        } catch (error: unknown) {
          this.logger.warn('QOTD scheduler check failed', error)
        }
      },
      { errorHandler: this.errorHandler.promiseCatch('qotd scheduler'), delay: Duration.minutes(1) }
    )

    this.application.addShutdownListener(() => {
      this.stop()
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

  private async checkAndTrigger(): Promise<void> {
    if (!isQotdEnabled(this.application)) return

    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const day = now.getDate()

    if (hour !== 19 || minute !== 0) return

    if (this.lastTriggeredDay === day) return
    this.lastTriggeredDay = day

    const channelId = this.application.core.discordConfigurations.getQotdChannelId()
    if (channelId === undefined) {
      this.logger.warn('QOTD channel not configured. Use /qotd channel to set it.')
      return
    }

    const guild = this.application.discordInstance.getClient().guilds.cache.first()
    if (!guild) {
      this.logger.warn('QOTD scheduler: no guild available.')
      return
    }

    const channel = await this.application.discordInstance
      .getClient()
      .channels.fetch(channelId)
      .catch(() => undefined)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      this.logger.warn(`QOTD channel ${channelId} is not a valid text channel.`)
      return
    }

    this.logger.info('Triggering scheduled QOTD at 7pm.')
    await runQotdFlow(channel as TextChannel, guild)
  }
}
