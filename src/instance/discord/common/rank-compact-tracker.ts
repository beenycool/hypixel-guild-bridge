import type { Message } from 'discord.js'

import type { GuildPlayerEventType } from '../../../common/application-event.js'

export interface CompactedRankEntry {
  userId: string
  initialRank: string
  currentRank: string
  initialType: GuildPlayerEventType.Promote | GuildPlayerEventType.Demote
  timestamp: number
  messages: Message[]
}

export function parseRankChange(message: string): { fromRank: string; toRank: string } | undefined {
  const promoteMatch = /was promoted from (.+?) to (.+?)$/i.exec(message)
  if (promoteMatch != undefined) {
    return { fromRank: promoteMatch[1].trim(), toRank: promoteMatch[2].trim() }
  }
  const demoteMatch = /was demoted from (.+?) to (.+?)$/i.exec(message)
  if (demoteMatch != undefined) {
    return { fromRank: demoteMatch[1].trim(), toRank: demoteMatch[2].trim() }
  }
  return undefined
}

export class RankCompactTracker {
  private readonly tracked = new Map<string, CompactedRankEntry>()

  private static readonly TtlMs = 24 * 60 * 60 * 1000

  public get(key: string): CompactedRankEntry | undefined {
    const entry = this.tracked.get(key)
    if (entry == undefined) return undefined
    if (Date.now() - entry.timestamp > RankCompactTracker.TtlMs) {
      this.tracked.delete(key)
      return undefined
    }
    return entry
  }

  public set(key: string, entry: CompactedRankEntry): void {
    this.tracked.set(key, entry)
  }

  public delete(key: string): void {
    this.tracked.delete(key)
  }

  public clear(): void {
    this.tracked.clear()
  }
}
