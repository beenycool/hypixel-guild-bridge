export type EvaluateResult =
  | { action: 'none' }
  | { action: 'promote'; targetRank: string; reason: string }
  | { action: 'demote'; targetRank: string; reason: string }
  | { action: 'kick'; reason: string }
  | { action: 'notify'; reason: string }

export interface MemberStats {
  uuid: string
  rank: string
  joinedAt: number
  weeklyGexp: number
  lastOnline?: number
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
  gracePeriod: number
  maxDaysInactive?: number
}

function resolveDemotion(rule: DemotionRule, reason: string): EvaluateResult {
  if (rule.action === 'kick') return { action: 'kick', reason }
  if (rule.action === 'notify') return { action: 'notify', reason }
  if (!rule.targetRank) return { action: 'none' }
  return { action: 'demote', targetRank: rule.targetRank, reason }
}

// checks if a guild member qualifies for a promo or needs to get demoted/kicked
export class RulesEvaluator {
  public evaluate(
    member: MemberStats,
    promotionRules: PromotionRule[],
    demotionRules: DemotionRule[],
    excludedRanks: string[],
    excludedPlayers: string[],
    rankPriority: string[]
  ): EvaluateResult {
    // don't touch excluded members (e.g. guild master, alts, officers)
    if (excludedPlayers.includes(member.uuid) || excludedRanks.includes(member.rank)) {
      return { action: 'none' }
    }

    const currentRankIndex = rankPriority.indexOf(member.rank.toLowerCase())
    if (currentRankIndex === -1) return { action: 'none' }

    // sort available promotions by highest priority rank first
    const possiblePromotions = promotionRules
      .filter((rule) => rankPriority.indexOf(rule.targetRank.toLowerCase()) > currentRankIndex)
      .toSorted(
        (a, b) => rankPriority.indexOf(b.targetRank.toLowerCase()) - rankPriority.indexOf(a.targetRank.toLowerCase())
      )

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

    // check if member is slacking and due for demote/kick
    const demotionRule = demotionRules.find((r) => r.fromRank.toLowerCase() === member.rank.toLowerCase())
    if (demotionRule && daysInGuild > demotionRule.gracePeriod) {
      if (member.weeklyGexp < demotionRule.maxWeeklyGexp) {
        return resolveDemotion(
          demotionRule,
          `Below requirements: ${member.weeklyGexp} < ${demotionRule.maxWeeklyGexp} GEXP after ${demotionRule.gracePeriod} days.`
        )
      }

      if (
        member.daysSinceLastSeen !== undefined &&
        demotionRule.maxDaysInactive !== undefined &&
        member.daysSinceLastSeen > demotionRule.maxDaysInactive
      ) {
        return resolveDemotion(
          demotionRule,
          `Inactive for ${member.daysSinceLastSeen.toFixed(1)} days (max ${demotionRule.maxDaysInactive}).`
        )
      }
    }

    return { action: 'none' }
  }
}
