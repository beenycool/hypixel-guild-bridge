import { uptime } from 'node:process'

import type Application from '../application'
import { ChannelType, Color, InstanceSignalType, InstanceType } from '../common/application-event'
import { Instance, InternalInstancePrefix } from '../common/instance'
import Duration from '../utility/duration'
import { setIntervalAsync } from '../utility/scheduling'

export default class AutoRestart extends Instance<InstanceType.Utility> {
  private static readonly DefaultMaxLifeTillRestart = Duration.hours(24)
  private static readonly CheckEvery = Duration.minutes(5)

  private intervalHandle: NodeJS.Timeout | undefined

  constructor(application: Application) {
    super(application, InternalInstancePrefix + 'auto-restart', InstanceType.Utility)

    // Config-gated: don't start the 5-minute wakeup timer at all when disabled.
    // Same pattern as VerificationRoleManager (config?.autoRoleUpdater.enabled)
    // and Application (config.prometheus.enabled / config.web?.enabled).
    if (!this.enabled()) return

    let shuttingDown = false

    this.intervalHandle = setIntervalAsync(
      async () => {
        if (!this.enabled()) return

        if (shuttingDown) return

        if (this.maxLifeTillRestart().toSeconds() < uptime()) {
          shuttingDown = true

          await this.application.emit('broadcast', {
            ...this.eventHelper.fillBaseEvent(),

            channels: [ChannelType.Public],
            color: Color.Info,

            user: undefined,
            message: 'Application Restarting: Scheduled restart'
          })

          await this.application.sendSignal([this.application.instanceName], InstanceSignalType.Restart)
        }
      },
      {
        delay: AutoRestart.CheckEvery,
        errorHandler: this.errorHandler.promiseCatch('sending signal to restart application')
      }
    )

    this.application.addShutdownListener(() => {
      this.stop()
    })
  }

  public stop(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
  }

  private enabled(): boolean {
    // Env override first (Heroku-style, no config.yaml edit needed),
    // then config file. Consistent with e.g. HACKCLUB_API_KEY ?? openrouterApiKey.
    return (
      AutoRestart.parseEnvEnabled(process.env.AUTO_RESTART_ENABLED) ??
      this.application.config.autoRestart?.enabled ??
      false
    )
  }

  private maxLifeTillRestart(): Duration {
    const environmentHours = AutoRestart.parseEnvHours(process.env.AUTO_RESTART_MAX_UPTIME_HOURS)
    const configHours = this.application.config.autoRestart?.maxUptimeHours
    const hours = environmentHours ?? configHours ?? AutoRestart.DefaultMaxLifeTillRestart.toHours()

    if (!Number.isFinite(hours) || hours <= 0) return AutoRestart.DefaultMaxLifeTillRestart
    return Duration.hours(hours)
  }

  private static parseEnvEnabled(raw: string | undefined): boolean | undefined {
    if (raw === undefined) return undefined
    const normalized = raw.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false
    return undefined
  }

  private static parseEnvHours(raw: string | undefined): number | undefined {
    if (raw === undefined || raw.trim() === '') return undefined
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
}
