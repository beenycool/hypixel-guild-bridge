import type { Logger } from 'log4js'

import { MatchStatus, type TournamentMatch, type TournamentPlayer } from './types.js'

interface MatchLinkReference {
  round: number
  matchIndex: number
}

export type GeneratedMatch = Omit<Partial<TournamentMatch>, 'nextMatchId' | 'loserNextMatchId'> & {
  winnerNext?: MatchLinkReference
  loserNext?: MatchLinkReference
}

interface BracketStrategy {
  name: string
  generate(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number
  ): { totalRounds: number; matches: GeneratedMatch[] }
  advanceWinner(
    match: TournamentMatch,
    winnerId: number,
    players: TournamentPlayer[]
  ): { winnerId: number; nextMatchId?: number; loserId?: number }
  isComplete(matches: TournamentMatch[]): boolean
  championId(matches: TournamentMatch[]): number | undefined
  progressesRounds(): boolean
  eliminatesLoser(): boolean
}

class SingleElimBracketStrategy implements BracketStrategy {
  name = 'single-elim'

  constructor(private readonly logger?: Logger) {}

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
  ): { totalRounds: number; matches: GeneratedMatch[] } {
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
    const matches: GeneratedMatch[] = []
    const round1MatchCount = totalSlots / 2
    const now = Math.floor(Date.now() / 1000)
    const deadlineAt = now + roundDeadlineHours * 3600

    for (let index = 0; index < round1MatchCount; index++) {
      const seed1 = seedOrder[2 * index]
      const seed2 = seedOrder[2 * index + 1]

      const p1 = seedToPlayerMap.get(seed1)
      const p2 = seedToPlayerMap.get(seed2)

      let status = MatchStatus.Pending
      let winnerId: number | undefined
      let completedAt: number | undefined

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
        player1Id: p1?.id,
        player2Id: p2?.id,
        winnerId,
        status,
        player1Wins: 0,
        player2Wins: 0,
        deadlineAt: status === MatchStatus.Active ? deadlineAt : undefined,
        completedAt,
        winnerNext: totalRounds > 1 ? { round: 2, matchIndex: Math.floor(index / 2) } : undefined
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
          completedAt: undefined,
          winnerNext: r < totalRounds ? { round: r + 1, matchIndex: Math.floor(index / 2) } : undefined
        })
      }
    }

    return { totalRounds, matches }
  }

  advanceWinner(
    match: TournamentMatch,
    winnerId: number
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

  championId(matches: TournamentMatch[]): number | undefined {
    if (matches.length === 0) return undefined
    const finalRound = Math.max(...matches.map((m) => m.round))
    const finalMatch = matches.find((m) => m.round === finalRound)
    return finalMatch?.winnerId
  }

  progressesRounds(): boolean {
    return true
  }

  eliminatesLoser(): boolean {
    return true
  }
}
class DoubleElimBracketStrategy implements BracketStrategy {
  name = 'double-elim'

  constructor(private readonly logger?: Logger) {}

  generate(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number
  ): { totalRounds: number; matches: GeneratedMatch[] } {
    const n = players.length
    if (n < 2) {
      throw new Error('Cannot generate bracket with less than 2 players.')
    }

    const upper = new SingleElimBracketStrategy(this.logger).generate(tournamentId, players, roundDeadlineHours)
    const totalUpperRounds = upper.totalRounds

    const ubByRound = new Map<number, GeneratedMatch[]>()
    for (const m of upper.matches) {
      if (m.round === undefined) continue
      const list = ubByRound.get(m.round) ?? []
      list.push(m)
      ubByRound.set(m.round, list)
    }

    interface LbEntrant {
      kind: 'ub' | 'lb'
      round: number
      matchIndex: number
    }

    const matches: GeneratedMatch[] = [...upper.matches]
    const lbIndexMap = new Map<string, GeneratedMatch>()
    let lbRoundNumber = totalUpperRounds + 1
    let pending: LbEntrant[] = []

    const linkSource = (entrant: LbEntrant, destinationRound: number, destinationIndex: number): void => {
      const destination = { round: destinationRound, matchIndex: destinationIndex }
      if (entrant.kind === 'ub') {
        const source = (ubByRound.get(entrant.round) ?? []).find((m) => m.matchIndex === entrant.matchIndex)
        if (source !== undefined) {
          source.loserNext = destination
        }
      } else {
        const source = lbIndexMap.get(`${entrant.round}_${entrant.matchIndex}`)
        if (source !== undefined) {
          source.winnerNext = destination
        }
      }
    }

    const pairEntrants = (entrants: LbEntrant[]): { pairs: [LbEntrant, LbEntrant][]; leftover: LbEntrant[] } => {
      const evens = entrants.filter((entrant) => entrant.matchIndex % 2 === 0)
      const odds = entrants.filter((entrant) => entrant.matchIndex % 2 === 1)
      const pairs: [LbEntrant, LbEntrant][] = []
      const take = (from: LbEntrant[]): LbEntrant => {
        const entrant = from.shift()
        if (entrant === undefined) throw new Error('Unexpected empty entrant list')
        return entrant
      }
      while (evens.length > 0 && odds.length > 0) {
        pairs.push([take(evens), take(odds)])
      }
      while (evens.length > 1) {
        pairs.push([take(evens), take(evens)])
      }
      while (odds.length > 1) {
        pairs.push([take(odds), take(odds)])
      }
      return { pairs, leftover: [...evens, ...odds] }
    }

    const pickRoundIndices = (matchCount: number, nextUbLosers: number, leftover: LbEntrant[]): number[] => {
      const firstLeftover = leftover[0] as LbEntrant | undefined
      const targetEvans =
        Math.ceil(nextUbLosers / 2) + (firstLeftover !== undefined && firstLeftover.matchIndex % 2 === 0 ? 1 : 0)
      const targetOdds =
        Math.floor(nextUbLosers / 2) + (firstLeftover !== undefined && firstLeftover.matchIndex % 2 === 1 ? 1 : 0)
      const nextEntrantCount = matchCount + nextUbLosers + leftover.length
      const slack = nextEntrantCount % 2
      const candidates: number[] = []
      for (let diff = -matchCount; diff <= matchCount; diff += 2) {
        if (Math.abs(diff - (targetOdds - targetEvans)) <= slack) {
          candidates.push(diff)
        }
      }
      candidates.sort((a, b) => {
        const distanceA = Math.abs(a - (targetOdds - targetEvans))
        const distanceB = Math.abs(b - (targetOdds - targetEvans))
        if (distanceA !== distanceB) return distanceA - distanceB
        return a - b
      })
      const chosenDiff = candidates[0] ?? (matchCount % 2 === 1 ? -1 : 0)
      const evenCount = (matchCount + chosenDiff) / 2
      const oddCount = matchCount - evenCount
      const evenIndices = Array.from({ length: evenCount }, (unused, index) => index * 2)
      const oddIndices = Array.from({ length: oddCount }, (unused, index) => index * 2 + 1)
      return [...evenIndices, ...oddIndices].toSorted((a, b) => a - b)
    }

    const addLbRound = (entrants: LbEntrant[], nextUbLosers: number): LbEntrant[] => {
      const { pairs, leftover } = pairEntrants(entrants)
      if (pairs.length === 0) return leftover
      const round = lbRoundNumber++
      const destinationIndices = pickRoundIndices(pairs.length, nextUbLosers, leftover)
      const roundMatches: GeneratedMatch[] = []
      for (const [index, pair] of pairs.entries()) {
        const destinationIndex = destinationIndices[index]
        linkSource(pair[0], round, destinationIndex)
        linkSource(pair[1], round, destinationIndex)
        const match: GeneratedMatch = {
          tournamentId,
          round,
          matchIndex: destinationIndex,
          player1Id: undefined,
          player2Id: undefined,
          winnerId: undefined,
          status: MatchStatus.Pending,
          player1Wins: 0,
          player2Wins: 0,
          deadlineAt: undefined,
          completedAt: undefined
        }
        roundMatches.push(match)
        lbIndexMap.set(`${round}_${destinationIndex}`, match)
      }
      matches.push(...roundMatches)
      const winners: LbEntrant[] = roundMatches.flatMap((m) =>
        m.round === undefined || m.matchIndex === undefined
          ? []
          : [{ kind: 'lb', round: m.round, matchIndex: m.matchIndex }]
      )
      return [...winners, ...leftover]
    }

    for (let r = 1; r <= totalUpperRounds; r++) {
      const losers: LbEntrant[] = (ubByRound.get(r) ?? [])
        .filter(
          (m): m is GeneratedMatch & { matchIndex: number } =>
            m.matchIndex !== undefined && (r === 1 ? m.status !== MatchStatus.Bye : true)
        )
        .map((m) => ({ kind: 'ub', round: r, matchIndex: m.matchIndex }))
      const nextLosers = (ubByRound.get(r + 1) ?? []).length
      pending = addLbRound([...pending, ...losers], nextLosers)
    }
    while (pending.length >= 2) {
      pending = addLbRound(pending, 0)
    }

    const grandFinalRound = lbRoundNumber
    const ubFinal = (ubByRound.get(totalUpperRounds) ?? [])[0] as GeneratedMatch | undefined
    if (ubFinal !== undefined) {
      ubFinal.winnerNext = { round: grandFinalRound, matchIndex: 0 }
    }
    const firstPending = pending[0] as LbEntrant | undefined
    if (firstPending !== undefined) {
      linkSource(firstPending, grandFinalRound, 0)
    }

    matches.push({
      tournamentId,
      round: grandFinalRound,
      matchIndex: 0,
      player1Id: undefined,
      player2Id: undefined,
      winnerId: undefined,
      status: MatchStatus.Pending,
      player1Wins: 0,
      player2Wins: 0,
      deadlineAt: undefined,
      completedAt: undefined
    })

    return { totalRounds: grandFinalRound, matches }
  }

  advanceWinner(
    match: TournamentMatch,
    winnerId: number
  ): { winnerId: number; nextMatchId?: number; loserId?: number } {
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    return {
      winnerId,
      nextMatchId: match.nextMatchId ?? undefined,
      loserId: loserId ?? undefined
    }
  }

  isComplete(matches: TournamentMatch[]): boolean {
    if (matches.length === 0) return false
    const finalRound = Math.max(...matches.map((m) => m.round))
    const grandFinal = matches.find((m) => m.round === finalRound)
    return grandFinal?.status === MatchStatus.Completed && grandFinal.winnerId !== undefined
  }

  championId(matches: TournamentMatch[]): number | undefined {
    if (matches.length === 0) return undefined
    const finalRound = Math.max(...matches.map((m) => m.round))
    return matches.find((m) => m.round === finalRound)?.winnerId
  }

  progressesRounds(): boolean {
    return false
  }

  eliminatesLoser(): boolean {
    return true
  }
}

class RoundRobinBracketStrategy implements BracketStrategy {
  name = 'round-robin'

  constructor(private readonly logger?: Logger) {}

  generate(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number
  ): { totalRounds: number; matches: GeneratedMatch[] } {
    const n = players.length
    if (n < 2) return { totalRounds: 1, matches: [] }

    const now = Math.floor(Date.now() / 1000)
    const deadlineAt = now + roundDeadlineHours * 3600
    const matches: GeneratedMatch[] = []
    let matchIndex = 0

    for (let index = 0; index < n; index++) {
      for (let otherIndex = index + 1; otherIndex < n; otherIndex++) {
        matches.push({
          tournamentId,
          round: 1,
          matchIndex: matchIndex++,
          player1Id: players[index].id,
          player2Id: players[otherIndex].id,
          status: MatchStatus.Active,
          player1Wins: 0,
          player2Wins: 0,
          deadlineAt,
          completedAt: undefined
        })
      }
    }

    return { totalRounds: 1, matches }
  }

  advanceWinner(
    match: TournamentMatch,
    winnerId: number
  ): { winnerId: number; nextMatchId?: number; loserId?: number } {
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    return { winnerId, loserId: loserId ?? undefined }
  }

  isComplete(matches: TournamentMatch[]): boolean {
    return matches.every((m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye)
  }

  championId(matches: TournamentMatch[]): number | undefined {
    const records = new Map<number, { wins: number; losses: number }>()
    for (const m of matches) {
      if (m.status !== MatchStatus.Completed) continue
      if (m.winnerId === undefined || m.player1Id === undefined || m.player2Id === undefined) continue
      const winner = records.get(m.winnerId) ?? { wins: 0, losses: 0 }
      winner.wins++
      records.set(m.winnerId, winner)
      const loserId = m.player1Id === m.winnerId ? m.player2Id : m.player1Id
      const loser = records.get(loserId) ?? { wins: 0, losses: 0 }
      loser.losses++
      records.set(loserId, loser)
    }
    const ranked = [...records.entries()].toSorted(([aId, a], [bId, b]) => {
      if (a.wins !== b.wins) return b.wins - a.wins
      if (a.losses !== b.losses) return a.losses - b.losses
      return aId - bId
    })
    return ranked[0]?.[0]
  }

  progressesRounds(): boolean {
    return false
  }

  eliminatesLoser(): boolean {
    return false
  }
}

export class BracketGenerator {
  private strategies = new Map<string, BracketStrategy>()

  constructor(private readonly logger?: Logger) {
    this.registerStrategy(new SingleElimBracketStrategy(this.logger))
    this.registerStrategy(new DoubleElimBracketStrategy(this.logger))
    this.registerStrategy(new RoundRobinBracketStrategy(this.logger))
  }

  registerStrategy(strategy: BracketStrategy): void {
    this.strategies.set(strategy.name, strategy)
  }

  getStrategy(name: string): BracketStrategy {
    const strategy = this.strategies.get(name) ?? this.strategies.get('single-elim')
    if (strategy === undefined) {
      throw new Error('Default bracket strategy "single-elim" is not registered')
    }
    return strategy
  }

  getSeedOrder(n: number): number[] {
    return new SingleElimBracketStrategy().getSeedOrder(n)
  }

  generateInitialMatches(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number,
    format = 'single-elim'
  ): { totalRounds: number; matches: GeneratedMatch[] } {
    const result = this.getStrategy(format).generate(tournamentId, players, roundDeadlineHours)
    return { totalRounds: result.totalRounds, matches: result.matches }
  }
}
