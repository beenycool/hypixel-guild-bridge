import { MatchStatus, type TournamentMatch, type TournamentPlayer } from './types.js'

export class BracketGenerator {
  /**
   * Generates a standard single-elimination bracket seed order for N slots (where N is a power of 2).
   */
  public getSeedOrder(n: number): number[] {
    let order = [1]
    while (order.length < n) {
      const nextOrder: number[] = []
      const target = order.length * 2 + 1
      for (const value of order) {
        nextOrder.push(value)
        nextOrder.push(target - value)
      }
      order = nextOrder
    }
    return order
  }

  /**
   * Generates the structure of all matches for the tournament.
   */
  public generateInitialMatches(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number
  ): {
    totalRounds: number
    matches: Omit<TournamentMatch, 'id' | 'nextMatchId'>[]
  } {
    const playerCount = players.length
    if (playerCount < 2) {
      throw new Error('Cannot generate bracket with less than 2 players.')
    }

    // Find next power of 2
    const totalSlots = Math.pow(2, Math.ceil(Math.log2(playerCount)))
    const totalRounds = Math.ceil(Math.log2(totalSlots))

    // Assign seeds to players (1-indexed based on their seed field)
    const sortedPlayers = players.map((p) => ({ ...p })).sort((a, b) => a.seed - b.seed)
    for (const [index, element] of sortedPlayers.entries()) {
      if (element.seed === 0) {
        element.seed = index + 1
      }
    }

    // Map seed to player
    const seedToPlayerMap = new Map<number, TournamentPlayer>()
    for (const p of sortedPlayers) {
      seedToPlayerMap.set(p.seed, p)
    }

    // Get the seed order for Round 1
    const seedOrder = this.getSeedOrder(totalSlots)

    const matchesToCreate: Omit<TournamentMatch, 'id' | 'nextMatchId'>[] = []

    const round1MatchCount = totalSlots / 2
    const now = Math.floor(Date.now() / 1000)
    const deadlineAt = now + roundDeadlineHours * 3600

    // Generate Round 1 matches
    for (let index = 0; index < round1MatchCount; index++) {
      const seed1 = seedOrder[2 * index]
      const seed2 = seedOrder[2 * index + 1]

      const p1 = seedToPlayerMap.get(seed1) ?? undefined
      const p2 = seedToPlayerMap.get(seed2) ?? undefined

      let status = MatchStatus.Pending
      let winnerId: number | undefined = undefined
      let completedAt: number | undefined = undefined

      if (p1 !== undefined && p2 === undefined) {
        // P1 has a bye
        status = MatchStatus.Bye
        winnerId = p1.id
        completedAt = now
      } else if (p1 === undefined && p2 !== undefined) {
        // P2 has a bye
        status = MatchStatus.Bye
        winnerId = p2.id
        completedAt = now
      } else if (p1 === undefined && p2 === undefined) {
        // Both are empty/bye
        status = MatchStatus.Bye
        completedAt = now
      } else {
        status = MatchStatus.Active
      }

      matchesToCreate.push({
        tournamentId,
        round: 1,
        matchIndex: index,
        player1Id: p1 === undefined ? undefined : p1.id,
        player2Id: p2 === undefined ? undefined : p2.id,
        winnerId,
        status,
        player1Wins: 0,
        player2Wins: 0,
        discordThreadId: undefined,
        deadlineAt: status === MatchStatus.Active ? deadlineAt : undefined,
        warningsSent: 0,
        completedAt,
        deadlineExtensionMinutes: 0,
        manuallyExtended: false,
        hadProofAttachment: false
      })
    }

    // Generate later rounds (Round 2 to totalRounds)
    for (let r = 2; r <= totalRounds; r++) {
      const matchCount = totalSlots / Math.pow(2, r)
      for (let index = 0; index < matchCount; index++) {
        matchesToCreate.push({
          tournamentId,
          round: r,
          matchIndex: index,
          player1Id: undefined,
          player2Id: undefined,
          winnerId: undefined,
          status: MatchStatus.Pending,
          player1Wins: 0,
          player2Wins: 0,
          discordThreadId: undefined,
          deadlineAt: undefined,
          warningsSent: 0,
          completedAt: undefined,
          deadlineExtensionMinutes: 0,
          manuallyExtended: false,
          hadProofAttachment: false
        })
      }
    }

    return { totalRounds, matches: matchesToCreate }
  }
}
