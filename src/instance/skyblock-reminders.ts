import assert from 'node:assert'

import type Application from '../application'
import { ChannelType, Color, InstanceType } from '../common/application-event'
import { Instance } from '../common/instance'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'
import { sleep } from '../utility/shared-utility'
import { getNextSkyblockEvents, type SkyblockEventKey, type SkyblockEventNext } from '../utility/skyblock-calendar'

export class SkyblockReminders extends Instance<InstanceType.Utility> {
  public static readonly DefaultDarkAuctionMessage = 'Dark Auction in {minutes} minute(s)!'
  public static readonly DefaultStarfallMessage = `Reminder: Star Cult is here. Get that free x200 starfall!`

  // Map by bridgeId (or '__GLOBAL__') -> (eventKey -> last notification data)
  private readonly lastSkyblockEventNotifications = new Map<
    string,
    Map<SkyblockEventKey, { startTimestamp: number; minutes: number }>
  >()

  private static readonly GlobalNotificationsKey = '__GLOBAL__'

  constructor(application: Application) {
    super(application, 'skyblock-reminders', InstanceType.Utility)

    this.startDarkAuctionReminder()
    this.startStarfallCultReminder()
    this.startSkyblockEventsNotifier()
  }

  private startDarkAuctionReminder(): void {
    let lastHourCheck = -1
    let lastMinuteCheck = -1

    setIntervalAsync(
      async () => {
        const date = new Date()
        const currentHour = date.getHours()
        const currentMinute = date.getMinutes()

        if (lastHourCheck === currentHour && lastMinuteCheck === currentMinute) return
        lastHourCheck = currentHour
        lastMinuteCheck = currentMinute

        if ([50, 54].includes(currentMinute)) {
          const remainingMinutes = 55 - currentMinute
          assert.ok(remainingMinutes > 0)

          const bridgeConfig = this.application.core.bridgeConfigurations
          const bridgeIds = this.application.bridgeResolver.isMultiBridgeEnabled()
            ? bridgeConfig.getAllBridgeIds()
            : [undefined]

          for (const bridgeId of bridgeIds) {
            const skyblockConfig = this.application.getSkyblockEventsConfig(bridgeId)
            if (!skyblockConfig?.enabled) continue

            const enabled = bridgeId
              ? bridgeConfig.getDarkAuctionReminder(bridgeId)
              : this.application.core.applicationConfigurations.getDarkAuctionReminder()

            if (!enabled) continue

            const message = bridgeId
              ? bridgeConfig
                  .getDarkAuctionReminderMessage(
                    bridgeId,
                    this.application.core.languageConfigurations.getDarkAuctionReminder()
                  )
                  .replaceAll('{minutes}', remainingMinutes.toString(10))
              : this.application.core.languageConfigurations
                  .getDarkAuctionReminder()
                  .replaceAll('{minutes}', remainingMinutes.toString(10))

            await this.application.emit('broadcast', {
              ...this.eventHelper.fillBaseEvent(),

              channels: [ChannelType.Public],
              color: Color.Good,

              user: undefined,
              message: message,
              bridgeId: bridgeId
            })
          }
        }
      },
      { errorHandler: this.errorHandler.promiseCatch('show dark auction reminder'), delay: Duration.seconds(60) }
    )
  }

  private startStarfallCultReminder(): void {
    let lastSkyblockDay = -1

    setIntervalAsync(
      async () => {
        const date = SkyblockReminders.getSkyblockTime()
        const currentSkyblockDay = date.day

        if (lastSkyblockDay === currentSkyblockDay) return
        lastSkyblockDay = currentSkyblockDay

        if ([7, 14, 21, 28].includes(currentSkyblockDay)) {
          const bridgeConfig = this.application.core.bridgeConfigurations
          const bridgeIds = this.application.bridgeResolver.isMultiBridgeEnabled()
            ? bridgeConfig.getAllBridgeIds()
            : [undefined]

          for (const bridgeId of bridgeIds) {
            const skyblockConfig = this.application.getSkyblockEventsConfig(bridgeId)
            if (!skyblockConfig?.enabled) continue

            const enabled = bridgeId
              ? bridgeConfig.getStarfallCultReminder(bridgeId)
              : this.application.core.applicationConfigurations.getStarfallCultReminder()

            if (!enabled) continue

            const message = bridgeId
              ? bridgeConfig.getStarfallReminderMessage(
                  bridgeId,
                  this.application.core.languageConfigurations.getStarfallReminder()
                )
              : this.application.core.languageConfigurations.getStarfallReminder()

            await this.application.emit('broadcast', {
              ...this.eventHelper.fillBaseEvent(),

              color: Color.Good,
              channels: [ChannelType.Public],

              user: undefined,
              message: message,
              bridgeId: bridgeId
            })
          }
        }
      },
      { errorHandler: this.errorHandler.promiseCatch('show starfall reminder'), delay: Duration.seconds(60) }
    )
  }

  private startSkyblockEventsNotifier(): void {
    // Subscribe to bridge config changes for immediate effect
    this.application.on('bridgeConfigChanged', (event) => {
      if (event.key.startsWith('skyblock')) {
        this.runImmediateCheckForBridge(event.bridgeId).catch(
          this.errorHandler.promiseCatch('immediate skyblock check')
        )
      }
    })

    setIntervalAsync(
      async () => {
        const now = Date.now()

        // If multi-bridge enabled, evaluate per-bridge
        if (this.application.bridgeResolver.isMultiBridgeEnabled()) {
          const bridgeIds = this.application.core.bridgeConfigurations.getAllBridgeIds()
          for (const bridgeId of bridgeIds) {
            const config = this.application.getSkyblockEventsConfig(bridgeId)
            if (!config?.enabled) continue

            const events = getNextSkyblockEvents(now)
            for (const event of events) {
              if (!this.isSkyblockEventEnabled(event.key, config.notifiers)) continue
              if (
                event.key === 'FALLEN_STAR_CULT' &&
                this.application.core.bridgeConfigurations.getStarfallCultReminder(bridgeId)
              ) {
                continue
              }

              const minutes = Math.floor((event.startTimestamp - now) / 1000 / 60)
              if (minutes < 0) continue
              if (!this.shouldNotifySkyblockEvent(event.key, minutes, config.customTimes)) continue

              const lastNotification = this.getLastNotificationForBridge(bridgeId).get(event.key)
              if (
                lastNotification &&
                lastNotification.startTimestamp === event.startTimestamp &&
                lastNotification.minutes === minutes
              ) {
                continue
              }

              await this.broadcastSkyblockEvent(event, minutes, bridgeId)
              this.getLastNotificationForBridge(bridgeId).set(event.key, {
                startTimestamp: event.startTimestamp,
                minutes
              })
              await sleep(1500)
            }
          }
          return
        }

        // Legacy single-global behaviour
        const config = this.application.getSkyblockEventsConfig()
        if (!config?.enabled) return

        const events = getNextSkyblockEvents(now)

        for (const event of events) {
          if (!this.isSkyblockEventEnabled(event.key, config.notifiers)) continue
          if (
            event.key === 'FALLEN_STAR_CULT' &&
            this.application.core.applicationConfigurations.getStarfallCultReminder()
          ) {
            continue
          }

          const minutes = Math.floor((event.startTimestamp - now) / 1000 / 60)
          if (minutes < 0) continue
          if (!this.shouldNotifySkyblockEvent(event.key, minutes, config.customTimes)) continue

          const lastNotification = this.getLastNotificationForBridge(SkyblockReminders.GlobalNotificationsKey).get(
            event.key
          )
          if (
            lastNotification &&
            lastNotification.startTimestamp === event.startTimestamp &&
            lastNotification.minutes === minutes
          ) {
            continue
          }

          await this.broadcastSkyblockEvent(event, minutes)
          this.getLastNotificationForBridge(SkyblockReminders.GlobalNotificationsKey).set(event.key, {
            startTimestamp: event.startTimestamp,
            minutes
          })
          await sleep(1500)
        }
      },
      {
        errorHandler: this.errorHandler.promiseCatch('show skyblock event reminders'),
        delay: Duration.minutes(1)
      }
    )
  }

  private getLastNotificationForBridge(bridgeId: string) {
    let map = this.lastSkyblockEventNotifications.get(bridgeId)
    if (!map) {
      map = new Map()
      this.lastSkyblockEventNotifications.set(bridgeId, map)
    }
    return map
  }

  private async runImmediateCheckForBridge(bridgeId?: string): Promise<void> {
    const now = Date.now()

    if (bridgeId === undefined || !this.application.bridgeResolver.isMultiBridgeEnabled()) {
      // Run global check immediately
      const config = this.application.getSkyblockEventsConfig()
      if (!config?.enabled) return

      const events = getNextSkyblockEvents(now)
      for (const event of events) {
        if (!this.isSkyblockEventEnabled(event.key, config.notifiers)) continue
        if (
          event.key === 'FALLEN_STAR_CULT' &&
          this.application.core.applicationConfigurations.getStarfallCultReminder()
        ) {
          continue
        }

        const minutes = Math.floor((event.startTimestamp - now) / 1000 / 60)
        if (minutes < 0) continue
        if (!this.shouldNotifySkyblockEvent(event.key, minutes, config.customTimes)) continue

        const lastNotification = this.getLastNotificationForBridge(SkyblockReminders.GlobalNotificationsKey).get(
          event.key
        )
        if (
          lastNotification &&
          lastNotification.startTimestamp === event.startTimestamp &&
          lastNotification.minutes === minutes
        ) {
          continue
        }

        await this.broadcastSkyblockEvent(event, minutes)
        this.getLastNotificationForBridge(SkyblockReminders.GlobalNotificationsKey).set(event.key, {
          startTimestamp: event.startTimestamp,
          minutes
        })
        await sleep(1500)
      }
      return
    }

    // Per-bridge immediate check
    const config = this.application.getSkyblockEventsConfig(bridgeId)
    if (!config?.enabled) return

    const events = getNextSkyblockEvents(now)
    for (const event of events) {
      if (!this.isSkyblockEventEnabled(event.key, config.notifiers)) continue
      if (
        event.key === 'FALLEN_STAR_CULT' &&
        this.application.core.bridgeConfigurations.getStarfallCultReminder(bridgeId)
      ) {
        continue
      }

      const minutes = Math.floor((event.startTimestamp - now) / 1000 / 60)
      if (minutes < 0) continue
      if (!this.shouldNotifySkyblockEvent(event.key, minutes, config.customTimes)) continue

      const lastNotification = this.getLastNotificationForBridge(bridgeId).get(event.key)
      if (
        lastNotification &&
        lastNotification.startTimestamp === event.startTimestamp &&
        lastNotification.minutes === minutes
      ) {
        continue
      }

      await this.broadcastSkyblockEvent(event, minutes, bridgeId)
      this.getLastNotificationForBridge(bridgeId).set(event.key, { startTimestamp: event.startTimestamp, minutes })
      await sleep(1500)
    }
  }
  private static getSkyblockTime(): { day: number } {
    const HourInMillisecond = 50_000
    const DayInMilliseconds = 24 * HourInMillisecond
    const MonthInMillisecond = 31 * DayInMilliseconds
    const Year0 = 1_560_275_700_000

    const currentEpoch = Date.now() - Year0
    const day = (currentEpoch % MonthInMillisecond) / DayInMilliseconds + 1
    return {
      day: Math.floor(day)
    }
  }

  private isSkyblockEventEnabled(eventKey: SkyblockEventKey, notifiers?: Record<string, boolean>): boolean {
    if (!notifiers) return true
    return notifiers[eventKey]
  }

  private shouldNotifySkyblockEvent(
    eventKey: SkyblockEventKey,
    minutes: number,
    customTimes?: Record<string, string[]>
  ): boolean {
    if (minutes === 0) return true
    if (!customTimes) return false

    for (const [minutesKey, events] of Object.entries(customTimes)) {
      const parsedMinutes = Number.parseInt(minutesKey, 10)
      if (!Number.isFinite(parsedMinutes)) continue
      if (parsedMinutes !== minutes) continue
      if (events.includes(eventKey)) return true
    }

    return false
  }

  private async broadcastSkyblockEvent(event: SkyblockEventNext, minutes: number, bridgeId?: string): Promise<void> {
    const t = this.application.getTranslatorForBridge(bridgeId)
    const message =
      minutes === 0
        ? t('instance.skyblockEvent.starting', { eventName: event.name })
        : t('instance.skyblockEvent.startingIn', { eventName: event.name, minutes: String(minutes) })

    await this.application.emit('broadcast', {
      ...this.eventHelper.fillBaseEvent(),

      channels: [ChannelType.Public],
      color: Color.Good,

      user: undefined,
      message: message,
      bridgeId: bridgeId
    })
  }
}
