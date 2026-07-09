import { MatchStatus, type TournamentMatch, type TournamentPlayer } from './types.js'

export interface BracketStrategy {
  name: string
  generate(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number
  ): { totalRounds: number; matches: Partial<TournamentMatch>[] }
  advanceWinner(
    match: TournamentMatch,
    winnerId: number,
    players: TournamentPlayer[]
  ): { winnerId: number; nextMatchId?: number; loserId?: number }
  isComplete(matches: TournamentMatch[]): boolean
}

export class SingleElimBracketStrategy implements BracketStrategy {
  name = 'single-elim'

  getSeedOrder(n: number): number[] {
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

  generate(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number
  ): { totalRounds: number; matches: Partial<TournamentMatch>[] } {
    const playerCount = players.length
    if (playerCount < 2) {
      throw new Error('Cannot generate bracket with less than 2 players.')
    }

    const totalSlots = Math.pow(2, Math.ceil(Math.log2(playerCount)))
    const totalRounds = Math.ceil(Math.log2(totalSlots))

    const sortedPlayers = players.toSorted((a, b) => a.seed - b.seed)
    for (const [index, element] of sortedPlayers.entries()) {
      if (element.seed === 0) {
        element.seed = index + 1
      }
    }

    const seedToPlayerMap = new Map<number, TournamentPlayer>()
    for (const p of sortedPlayers) {
      seedToPlayerMap.set(p.seed, p)
    }

    const seedOrder = this.getSeedOrder(totalSlots)

    const matches: Partial<TournamentMatch>[] = []

    const round1MatchCount = totalSlots / 2
    const now = Math.floor(Date.now() / 1000)
    const deadlineAt = now + roundDeadlineHours * 3600

    for (let index = 0; index < round1MatchCount; index++) {
      const seed1 = seedOrder[2 * index]
      const seed2 = seedOrder[2 * index + 1]

      const p1 = seedToPlayerMap.get(seed1) ?? undefined
      const p2 = seedToPlayerMap.get(seed2) ?? undefined

      let status = MatchStatus.Pending
      let winnerId: number | undefined = undefined
      let completedAt: number | undefined = undefined

      if (p1 !== undefined && p2 === undefined) {
        status = MatchStatus.Bye
        winnerId = p1.id
        completedAt = now
      } else if (p1 === undefined && p2 !== undefined) {
        status = MatchStatus.Bye
        winnerId = p2.id
        completedAt = now
      } else if (p1 === undefined && p2 === undefined) {
        status = MatchStatus.Bye
        completedAt = now
      } else {
        status = MatchStatus.Active
      }

      matches.push({
        tournamentId,
        round: 1,
        matchIndex: index,
        player1Id: p1 === undefined ? undefined : p1.id,
        player2Id: p2 === undefined ? undefined : p2.id,
        winnerId,
        status,
        player1Wins: 0,
        player2Wins: 0,
        deadlineAt: status === MatchStatus.Active ? deadlineAt : undefined,
        completedAt
      })
    }

    for (let r = 2; r <= totalRounds; r++) {
      const matchCount = totalSlots / Math.pow(2, r)
      for (let index = 0; index < matchCount; index++) {
        matches.push({
          tournamentId,
          round: r,
          matchIndex: index,
          player1Id: undefined,
          player2Id: undefined,
          winnerId: undefined,
          status: MatchStatus.Pending,
          player1Wins: 0,
          player2Wins: 0,
          deadlineAt: undefined,
          completedAt: undefined
        })
      }
    }

    return { totalRounds, matches }
  }

  advanceWinner(
    match: TournamentMatch,
    winnerId: number,
    players: TournamentPlayer[]
  ): { winnerId: number; nextMatchId?: number; loserId?: number } {
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    return {
      winnerId,
      nextMatchId: match.nextMatchId ?? undefined,
      loserId: loserId ?? undefined
    }
  }

  isComplete(matches: TournamentMatch[]): boolean {
    const finalRound = Math.max(...matches.map((m) => m.round))
    const finalMatches = matches.filter((m) => m.round === finalRound)
    return finalMatches.every((m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye)
  }
}

export class DoubleElimBracketStrategy implements BracketStrategy {
  name = 'double-elim'

  generate(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number
  ): { totalRounds: number; matches: Partial<TournamentMatch>[] } {
    const n = players.length
    if (n < 2) return { totalRounds: 1, matches: [] }

    const totalRounds = Math.ceil(Math.log2(n)) * 2
    const allMatches: Partial<TournamentMatch>[] = []

    const winnersBracket = new SingleElimBracketStrategy()
    const upper = winnersBracket.generate(tournamentId, players, roundDeadlineHours)

    for (const match of upper.matches) {
      allMatches.push(match)
    }

    const loserCount = Math.floor(n / 2)
    for (let i = 0; i < loserCount; i++) {
      allMatches.push({
        tournamentId,
        round: totalRounds - Math.ceil(Math.log2(n)) + 1,
        matchIndex: i,
        player1Id: undefined,
        player2Id: undefined,
        winnerId: undefined,
        status: MatchStatus.Pending,
        player1Wins: 0,
        player2Wins: 0
      })
    }

    allMatches.push({
      tournamentId,
      round: totalRounds,
      matchIndex: 0,
      player1Id: undefined,
      player2Id: undefined,
      winnerId: undefined,
      status: MatchStatus.Pending,
      player1Wins: 0,
      player2Wins: 0
    })

    return { totalRounds: totalRounds + 1, matches: allMatches }
  }

  advanceWinner(
    match: TournamentMatch,
    winnerId: number,
    players: TournamentPlayer[]
  ): { winnerId: number; nextMatchId?: number; loserId?: number } {
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    return {
      winnerId,
      nextMatchId: match.nextMatchId ?? undefined,
      loserId: loserId ?? undefined
    }
  }

  isComplete(matches: TournamentMatch[]): boolean {
    const finalMatches = matches.filter((m) => m.round === Math.max(...matches.map((x) => x.round)))
    return finalMatches.some((m) => m.status === MatchStatus.Completed && m.winnerId !== null)
  }
}

export class RoundRobinBracketStrategy implements BracketStrategy {
  name = 'round-robin'

  generate(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number
  ): { totalRounds: number; matches: Partial<TournamentMatch>[] } {
    const n = players.length
    if (n < 2) return { totalRounds: 1, matches: [] }

    const matches: Partial<TournamentMatch>[] = []
    let matchIndex = 0

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        matches.push({
          tournamentId,
          round: 1,
          matchIndex: matchIndex++,
          player1Id: players[i].id,
          player2Id: players[j].id,
          status: MatchStatus.Pending,
          player1Wins: 0,
          player2Wins: 0
        })
      }
    }

    return { totalRounds: 1, matches }
  }

  advanceWinner(
    match: TournamentMatch,
    winnerId: number,
    players: TournamentPlayer[]
  ): { winnerId: number; nextMatchId?: number; loserId?: number } {
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    return { winnerId, loserId: loserId ?? undefined }
  }

  isComplete(matches: TournamentMatch[]): boolean {
    return matches.every((m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye)
  }
}

export class BracketGenerator {
  private strategies = new Map<string, BracketStrategy>()

  constructor() {
    this.registerStrategy(new SingleElimBracketStrategy())
    this.registerStrategy(new DoubleElimBracketStrategy())
    this.registerStrategy(new RoundRobinBracketStrategy())
  }

  registerStrategy(strategy: BracketStrategy): void {
    this.strategies.set(strategy.name, strategy)
  }

  getStrategy(name: string): BracketStrategy {
    return this.strategies.get(name) ?? this.strategies.get('single-elim')!
  }

  getSeedOrder(n: number): number[] {
    return new SingleElimBracketStrategy().getSeedOrder(n)
  }

  generateInitialMatches(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number,
    format = 'single-elim'
  ): { totalRounds: number; matches: Omit<TournamentMatch, 'id' | 'nextMatchId'>[] } {
    const result = this.getStrategy(format).generate(tournamentId, players, roundDeadlineHours)
    return { totalRounds: result.totalRounds, matches: result.matches as Omit<TournamentMatch, 'id' | 'nextMatchId'>[] }
  }
}
