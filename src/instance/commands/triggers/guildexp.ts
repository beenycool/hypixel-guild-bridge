import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import type { MemberStats } from '../../../core/rankup/rules-evaluator.js'
import { RulesEvaluator } from '../../../core/rankup/rules-evaluator.js'
import { getUuidIfExists, usernameNotExists } from '../common/utility'

type Period = 'daily' | 'weekly' | 'monthly'

const ValidPeriods = new Set<Period>(['daily', 'weekly', 'monthly'])

interface GuildMemberData {
  uuid: string
  rank: string
  joinedAt: Date | number
  weeklyExperience?: number
  expHistory?: { day: string; date: Date; exp: number; totalExp: number }[]
}

interface GuildData {
  ranks: { name: string; priority: number }[]
}

export default class GuildExperience extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['guildexp', 'gexp'],
      description: 'Guild experience of specified user. Usage: gexp [daily|weekly|monthly] [username]',
      example: `gexp daily %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const { period, username } = this.parseArguments(context)

    const uuid = await getUuidIfExists(context.app.mojangApi, username)
    if (uuid == undefined) return usernameNotExists(context, username)

    const guild = await context.app.hypixelApi.getGuild('player', uuid, {}).catch(() => undefined)
    if (!guild) return `${username} is not in a guild.`

    const member = guild.members.find((entry) => entry.uuid === uuid)
    if (!member) return `${username} is not in a guild.`

    return this.formatResponse(username, period, member, context, guild as GuildData)
  }

  private parseArguments(context: ChatCommandContext): { period: Period; username: string } {
    const argumentsLength = context.args.length

    if (argumentsLength === 0) {
      return { period: 'weekly', username: context.username }
    }

    if (argumentsLength === 1) {
      const argument = context.args[0].toLowerCase()
      if (ValidPeriods.has(argument as Period)) {
        return { period: argument as Period, username: context.username }
      }
      return { period: 'weekly', username: context.args[0] }
    }

    const firstArgument = context.args[0].toLowerCase()
    const secondArgument = context.args[1].toLowerCase()

    if (ValidPeriods.has(firstArgument as Period)) {
      return { period: firstArgument as Period, username: context.args[1] }
    }

    if (ValidPeriods.has(secondArgument as Period)) {
      return { period: secondArgument as Period, username: context.args[0] }
    }

    return { period: 'weekly', username: context.args[0] }
  }

  private formatResponse(
    username: string,
    period: Period,
    member: GuildMemberData,
    context?: ChatCommandContext,
    guild?: GuildData
  ): string {
    switch (period) {
      case 'daily': {
        const dailyExp = this.getDailyExperience(member)
        return `${username}'s Daily Guild Experience: ${dailyExp.toLocaleString('en-US')}.`
      }
      case 'weekly': {
        const weeklyExp = member.weeklyExperience ?? 0
        const baseMessage = `${username}'s Weekly Guild Experience: ${weeklyExp.toLocaleString('en-US')}.`
        if (context && guild) {
          const promoInfo = this.getPromotionInfo(context, guild, member)
          if (promoInfo) {
            return `${username}'s Weekly Guild Experience: ${weeklyExp.toLocaleString('en-US')}.${promoInfo}`
          }
        }
        return baseMessage
      }
      case 'monthly': {
        return `${username}'s Monthly Guild Experience: Not available from Hypixel API (only 7 days of history provided).`
      }
    }
  }

  private getPromotionInfo(context: ChatCommandContext, guild: GuildData, member: GuildMemberData): string {
    const bridgeId = context.app.bridgeResolver.getBridgeIdForInstance(context.message.instanceName)
    if (!bridgeId) return ''

    const bridgeConfig = context.app.core.bridgeConfigurations
    const promotionRules = bridgeConfig.getRankupRules(bridgeId)
    if (promotionRules.length === 0) return ''

    const demotionRules = bridgeConfig.getRankupDemotionRules(bridgeId)
    const excludedRanks = bridgeConfig.getRankupExcludedRanks(bridgeId)
    const excludedPlayers = bridgeConfig.getRankupExcludedPlayers(bridgeId)
    const rankupEnabled = bridgeConfig.getRankupEnabled(bridgeId)
    const manualReview = bridgeConfig.getRankupManualReview(bridgeId)

    const rankPriority = guild.ranks.toSorted((a, b) => a.priority - b.priority).map((r) => r.name.toLowerCase())
    const weeklyExp = member.weeklyExperience ?? 0
    const joinedAtTime =
      typeof member.joinedAt === 'number' ? member.joinedAt : member.joinedAt ? member.joinedAt.getTime() : Date.now()
    const daysInGuild = (Date.now() - joinedAtTime) / (1000 * 60 * 60 * 24)

    const stats: MemberStats = {
      uuid: member.uuid,
      rank: member.rank,
      joinedAt: joinedAtTime,
      weeklyGexp: weeklyExp
    }

    const evaluator = new RulesEvaluator()
    const result = evaluator.evaluate(
      stats,
      promotionRules,
      demotionRules,
      excludedRanks,
      excludedPlayers,
      rankPriority
    )

    if (result.action === 'promote') {
      let statusText = ` Eligible for promotion to ${result.targetRank}!`
      if (rankupEnabled) {
        if (manualReview) {
          statusText += ' (Pending staff review)'
        } else {
          statusText += ' (Auto-promoting...)'
          context.app.core.rankupManager.runTaskForBridge(bridgeId).catch((error: unknown) => {
            context.logger.error(`Error running rankup manager task for bridge ${bridgeId}:`, error)
          })
        }
      }
      return statusText
    }

    const currentRankIndex = rankPriority.indexOf(member.rank.toLowerCase())
    if (currentRankIndex !== -1) {
      const nextRules = promotionRules
        .filter((rule) => {
          const targetIndex = rankPriority.indexOf(rule.targetRank.toLowerCase())
          return targetIndex > currentRankIndex
        })
        .toSorted((a, b) => {
          const indexA = rankPriority.indexOf(a.targetRank.toLowerCase())
          const indexB = rankPriority.indexOf(b.targetRank.toLowerCase())
          return indexA - indexB
        })

      const nextRule = nextRules[0]
      if (nextRule) {
        const gexpNeeded = Math.max(0, nextRule.minWeeklyGexp - weeklyExp)
        const gexpProgress = `${weeklyExp.toLocaleString('en-US')} / ${nextRule.minWeeklyGexp.toLocaleString('en-US')} GEXP`
        const daysProgress =
          daysInGuild < nextRule.minDaysInGuild
            ? ` & ${Math.floor(daysInGuild)}/${nextRule.minDaysInGuild} days in guild`
            : ''
        return ` Next rank [${nextRule.targetRank}]: ${gexpProgress}${gexpNeeded > 0 ? ` (${gexpNeeded.toLocaleString('en-US')} needed)` : ''}${daysProgress}.`
      }
    }

    return ''
  }

  private getDailyExperience(member: {
    expHistory?: { day: string; date: Date; exp: number; totalExp: number }[]
  }): number {
    if (!member.expHistory || member.expHistory.length === 0) return 0

    const sorted = member.expHistory.toSorted((a, b) => b.date.getTime() - a.date.getTime())
    return sorted[0]?.exp ?? 0
  }
}
