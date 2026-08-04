import { isAxiosError } from 'axios'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { httpClient } from '../../../common/http.js'

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly'

const ValidPeriods = new Set<Period>(['daily', 'weekly', 'monthly', 'yearly'])

const PERIOD_NAMES: Record<Period, string> = {
  daily: 'D',
  weekly: 'W',
  monthly: 'M',
  yearly: 'Y'
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) {
    const value = n / 1_000_000
    return value < 10 ? value.toFixed(1) + 'M' : Math.round(value).toString() + 'M'
  }
  if (n >= 1000) {
    const value = n / 1000
    return value < 10 ? value.toFixed(1) + 'K' : Math.round(value).toString() + 'K'
  }
  return n.toString()
}

export default class GuildSessions extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['guildstats', 'gstats', 'gactivity'],
      description: 'Show guild activity stats for a period.',
      example: 'guildstats weekly'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const apiKey = context.app.urchinApiKey
    if (!apiKey) {
      return context.app.i18n.t(($) => $['commands.guild-stats.no-key'])
    }

    let period: Period = 'weekly'
    if (context.args.length > 0) {
      const argument = context.args[0].toLowerCase()
      if (ValidPeriods.has(argument as Period)) {
        period = argument as Period
      }
    }

    const bridgeId = context.message.bridgeId
    if (bridgeId && ['guab', 'persy'].includes(bridgeId)) {
      return 'This command is not available for this bridge.'
    }
    const guildName = bridgeId ? context.app.core.bridgeConfigurations.getGuildName(bridgeId) : undefined
    if (!guildName) {
      return 'Guild name not resolved yet. Wait for the bot to connect and try again.'
    }

    try {
      const response = await httpClient.get<{
        // eslint-disable-next-line @typescript-eslint/naming-convention -- API response field name
        guild_id: string
        name: string
        from: number
        // eslint-disable-next-line @typescript-eslint/naming-convention -- API response field name
        from_readable: string
        members?: Record<string, { gexp?: { total: number } }>
      }>(`https://api.urchin.gg/v3/guild/sessions/${period}`, {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the API
        headers: { 'X-API-Key': apiKey },
        params: { guild: guildName }
      })

      const members = response.data.members ?? {}
      if (Object.keys(members).length === 0) {
        return context.app.i18n.t(($) => $['commands.guild-stats.no-data'])
      }

      const totalGexp = Object.values(members).reduce((sum, m) => sum + (m.gexp?.total ?? 0), 0)
      const activeCount = Object.values(members).filter((m) => (m.gexp?.total ?? 0) > 0).length

      return context.app.i18n.t(($) => $['commands.guild-stats.result'], {
        period: PERIOD_NAMES[period],
        name: response.data.name,
        gexp: fmtCompact(totalGexp),
        activeCount,
        totalMembers: Object.keys(members).length
      })
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        if (error.response?.status === 403) {
          return context.app.i18n.t(($) => $['commands.guild-stats.membership'])
        }
        if (error.response?.status === 404) {
          return context.app.i18n.t(($) => $['commands.guild-stats.not-found'])
        }
        if (error.response?.status === 401) {
          return context.app.i18n.t(($) => $['commands.guild-stats.invalid-key'])
        }
      }
      context.logger.error(error)
      return context.app.i18n.t(($) => $['commands.guild-stats.error'])
    }
  }
}
