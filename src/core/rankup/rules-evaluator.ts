export type EvaluateResult =
  | { action: 'none' }
  | { action: 'promote'; targetRank: string; reason: string }
  | { action: 'demote'; targetRank: string; reason: string }
  | { action: 'kick'; reason: string }
  | { action: 'notify'; reason: string }

export interface MemberStats {
  uuid: string
  rank: string
  joinedAt: number // timestamp
  weeklyGexp: number
  lastOnline?: number // timestamp
  daysSinceLastSeen?: number
}

export interface PromotionRule {
  targetRank: string
  minWeeklyGexp: number
  minDaysInGuild: number
  minOnlineHours: number
}

export interface DemotionRule {
  fromRank: string
  action: 'demote' | 'kick' | 'notify'
  targetRank?: string
  maxWeeklyGexp: number
  gracePeriod: number // days since joining
  maxDaysInactive?: number
}

export class RulesEvaluator {
  public evaluate(
    member: MemberStats,
    promotionRules: PromotionRule[],
    demotionRules: DemotionRule[],
    excludedRanks: string[],
    excludedPlayers: string[],
    rankPriority: string[] // Ordered list of ranks from lowest to highest
  ): EvaluateResult {
    if (excludedPlayers.includes(member.uuid) || excludedRanks.includes(member.rank)) {
      return { action: 'none' }
    }

    // Sort rules by target rank priority (highest first for promotion)
    // We assume rankPriority[0] is lowest, rankPriority[length-1] is highest
    const currentRankIndex = rankPriority.indexOf(member.rank.toLowerCase())
    if (currentRankIndex === -1) return { action: 'none' } // Unknown rank

    // Check Promotions
    const possiblePromotions = promotionRules
      .filter((rule) => {
        const targetIndex = rankPriority.indexOf(rule.targetRank.toLowerCase())
        return targetIndex > currentRankIndex
      })
      .toSorted((a, b) => {
        const indexA = rankPriority.indexOf(a.targetRank.toLowerCase())
        const indexB = rankPriority.indexOf(b.targetRank.toLowerCase())
        return indexB - indexA // Descending priority
      })

    const daysInGuild = (Date.now() - member.joinedAt) / (1000 * 60 * 60 * 24)

    for (const rule of possiblePromotions) {
      if (member.weeklyGexp >= rule.minWeeklyGexp && daysInGuild >= rule.minDaysInGuild) {
        return {
          action: 'promote',
          targetRank: rule.targetRank,
          reason: `Met requirements: ${member.weeklyGexp} GEXP, ${daysInGuild.toFixed(1)} days in guild.`
        }
      }
    }

    // Check Demotions
    const applicableDemotion = demotionRules.find((r) => r.fromRank.toLowerCase() === member.rank.toLowerCase())
    if (
      applicableDemotion &&
      daysInGuild > applicableDemotion.gracePeriod &&
      member.weeklyGexp < applicableDemotion.maxWeeklyGexp
    ) {
      const reason = `Below requirements: ${member.weeklyGexp} < ${applicableDemotion.maxWeeklyGexp} GEXP after ${applicableDemotion.gracePeriod} days.`

      if (applicableDemotion.action === 'kick') {
        return { action: 'kick', reason }
      }

      if (applicableDemotion.action === 'notify') {
        return { action: 'notify', reason }
      }

      if (applicableDemotion.targetRank === undefined) {
        return { action: 'none' }
      }

      return {
        action: 'demote' as const,
        targetRank: applicableDemotion.targetRank,
        reason
      }
    }

    // Check Inactivity-based demotion
    if (member.daysSinceLastSeen !== undefined) {
      const inactiveRule = demotionRules.find(
        (r) => r.fromRank.toLowerCase() === member.rank.toLowerCase() && r.maxDaysInactive !== undefined
      )
      const maxDaysInactive = inactiveRule?.maxDaysInactive
      if (
        inactiveRule &&
        daysInGuild > inactiveRule.gracePeriod &&
        maxDaysInactive !== undefined &&
        member.daysSinceLastSeen > maxDaysInactive
      ) {
        const reason = `Inactive for ${member.daysSinceLastSeen.toFixed(1)} days (max ${maxDaysInactive}).`

        if (inactiveRule.action === 'kick') {
          return { action: 'kick', reason }
        }

        if (inactiveRule.action === 'notify') {
          return { action: 'notify', reason }
        }

        if (inactiveRule.targetRank === undefined) {
          return { action: 'none' }
        }

        return {
          action: 'demote' as const,
          targetRank: inactiveRule.targetRank,
          reason
        }
      }
    }

    return { action: 'none' }
  }
}
