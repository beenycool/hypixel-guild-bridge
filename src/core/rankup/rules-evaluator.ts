export interface MemberStats {
  uuid: string
  rank: string
  joinedAt: number // timestamp
  weeklyGexp: number
  lastOnline?: number // timestamp
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
}

export class RulesEvaluator {
  public evaluate(
    member: MemberStats,
    promotionRules: PromotionRule[],
    demotionRules: DemotionRule[],
    excludedRanks: string[],
    excludedPlayers: string[],
    rankPriority: string[] // Ordered list of ranks from lowest to highest
  ): { action: 'promote' | 'demote' | 'kick' | 'none'; targetRank?: string; reason?: string } {
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
    // online hours calculation might be approximate if we only have join/quit logs,
    // but here we might rely on what's available or just ignore if not tracked perfectly yet.
    // For now, let's assume online hours is 0 if we don't have better data, or rely on other stats.
    const onlineHours = 0 // Placeholder until we have robust online tracking; minOnlineHours > 0 blocks promote until implemented

    for (const rule of possiblePromotions) {
      if (
        member.weeklyGexp >= rule.minWeeklyGexp &&
        daysInGuild >= rule.minDaysInGuild &&
        onlineHours >= rule.minOnlineHours
      ) {
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
      if (applicableDemotion.action === 'demote' && applicableDemotion.targetRank === undefined) {
        return { action: 'none' }
      }

      return {
        action: applicableDemotion.action === 'notify' ? 'none' : applicableDemotion.action, // 'notify' might be handled differently later, treating as 'none' for automation for now or maybe 'demote' if config implies
        targetRank: applicableDemotion.targetRank,
        reason: `Below requirements: ${member.weeklyGexp} < ${applicableDemotion.maxWeeklyGexp} GEXP after ${applicableDemotion.gracePeriod} days.`
      }
    }

    return { action: 'none' }
  }
}
