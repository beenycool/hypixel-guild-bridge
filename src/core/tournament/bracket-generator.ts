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

export interface BracketStrategy {
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

// classic power-of-2 seed ordering so #1 plays lowest seed, #2 plays 2nd lowest etc
function getSeedOrder(totalSlots: number): number[] {
  let order = [1]
  while (order.length < totalSlots) {
    const nextOrder: number[] = []
    const target = order.length * 2 + 1
    for (const value of order) {
      nextOrder.push(value, target - value)
    }
    order = nextOrder
  }
  return order
}

// single elimination - standard tournament tree
const singleElim: BracketStrategy = {
  name: 'single-elim',

  generate(tournamentId: number, players: TournamentPlayer[], roundDeadlineHours: number) {
    const playerCount = players.length
    if (playerCount < 2) throw new Error('Need at least 2 players to generate a bracket lol')

    const totalSlots = Math.pow(2, Math.ceil(Math.log2(playerCount)))
    const totalRounds = Math.ceil(Math.log2(totalSlots))

    const sorted = players.toSorted((a, b) => a.seed - b.seed)
    for (const [index, player] of sorted.entries()) {
      if (player.seed === 0) player.seed = index + 1
    }

    const seedMap = new Map<number, TournamentPlayer>()
    for (const player of sorted) seedMap.set(player.seed, player)

    const seedOrder = getSeedOrder(totalSlots)
    const matches: GeneratedMatch[] = []
    const round1Count = totalSlots / 2
    const now = Math.floor(Date.now() / 1000)
    const deadlineAt = now + roundDeadlineHours * 3600

    for (let index = 0; index < round1Count; index++) {
      const p1 = seedMap.get(seedOrder[2 * index])
      const p2 = seedMap.get(seedOrder[2 * index + 1])

      let status = MatchStatus.Active
      let winnerId: number | undefined
      let completedAt: number | undefined

      // handle byes when player count isn't an exact power of 2
      if (p1 && !p2) {
        status = MatchStatus.Bye
        winnerId = p1.id
        completedAt = now
      } else if (!p1 && p2) {
        status = MatchStatus.Bye
        winnerId = p2.id
        completedAt = now
      } else if (!p1 && !p2) {
        status = MatchStatus.Bye
        completedAt = now
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

    for (let round = 2; round <= totalRounds; round++) {
      const matchCount = totalSlots / Math.pow(2, round)
      for (let index = 0; index < matchCount; index++) {
        matches.push({
          tournamentId,
          round,
          matchIndex: index,
          player1Id: undefined,
          player2Id: undefined,
          winnerId: undefined,
          status: MatchStatus.Pending,
          player1Wins: 0,
          player2Wins: 0,
          deadlineAt: undefined,
          completedAt: undefined,
          winnerNext: round < totalRounds ? { round: round + 1, matchIndex: Math.floor(index / 2) } : undefined
        })
      }
    }

    return { totalRounds, matches }
  },

  advanceWinner(match: TournamentMatch, winnerId: number) {
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    return { winnerId, nextMatchId: match.nextMatchId ?? undefined, loserId: loserId ?? undefined }
  },

  isComplete(matches: TournamentMatch[]) {
    const finalRound = Math.max(...matches.map((m) => m.round))
    const finals = matches.filter((m) => m.round === finalRound)
    return finals.every((m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye)
  },

  championId(matches: TournamentMatch[]) {
    if (matches.length === 0) return
    const finalRound = Math.max(...matches.map((m) => m.round))
    return matches.find((m) => m.round === finalRound)?.winnerId
  },

  progressesRounds: () => true,
  eliminatesLoser: () => true
}

// double elimination - losers drop into lower bracket
const doubleElim: BracketStrategy = {
  name: 'double-elim',

  generate(tournamentId: number, players: TournamentPlayer[], roundDeadlineHours: number) {
    const playerCount = players.length
    if (playerCount < 2) throw new Error('Need at least 2 players for double elim')

    const upper = singleElim.generate(tournamentId, players, roundDeadlineHours)
    const upperRounds = upper.totalRounds

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
    const lbMap = new Map<string, GeneratedMatch>()
    let lbRound = upperRounds + 1
    let pending: LbEntrant[] = []

    const linkSource = (entrant: LbEntrant, targetRound: number, targetIndex: number) => {
      const destination = { round: targetRound, matchIndex: targetIndex }
      if (entrant.kind === 'ub') {
        const source = (ubByRound.get(entrant.round) ?? []).find((m) => m.matchIndex === entrant.matchIndex)
        if (source) source.loserNext = destination
      } else {
        const source = lbMap.get(`${entrant.round}_${entrant.matchIndex}`)
        if (source) source.winnerNext = destination
      }
    }

    const pairEntrants = (entrants: LbEntrant[]) => {
      const evens = entrants.filter((entrant) => entrant.matchIndex % 2 === 0)
      const odds = entrants.filter((entrant) => entrant.matchIndex % 2 === 1)
      const pairs: [LbEntrant, LbEntrant][] = []
      const pop = (array: LbEntrant[]) => {
        const item = array.shift()
        if (!item) throw new Error('Empty entrant queue in bracket pairer')
        return item
      }
      while (evens.length > 0 && odds.length > 0) pairs.push([pop(evens), pop(odds)])
      while (evens.length > 1) pairs.push([pop(evens), pop(evens)])
      while (odds.length > 1) pairs.push([pop(odds), pop(odds)])
      return { pairs, leftover: [...evens, ...odds] }
    }

    const pickIndices = (matchCount: number, nextUbLosers: number, leftover: LbEntrant[]): number[] => {
      const first = leftover[0] as LbEntrant | undefined
      const targetEvens = Math.ceil(nextUbLosers / 2) + (first && first.matchIndex % 2 === 0 ? 1 : 0)
      const targetOdds = Math.floor(nextUbLosers / 2) + (first && first.matchIndex % 2 === 1 ? 1 : 0)
      const slack = (matchCount + nextUbLosers + leftover.length) % 2
      const candidates: number[] = []
      for (let difference = -matchCount; difference <= matchCount; difference += 2) {
        if (Math.abs(difference - (targetOdds - targetEvens)) <= slack) candidates.push(difference)
      }
      candidates.sort((a, b) => {
        const distanceA = Math.abs(a - (targetOdds - targetEvens))
        const distanceB = Math.abs(b - (targetOdds - targetEvens))
        if (distanceA === distanceB) return a - b
        return distanceA - distanceB
      })
      const difference = candidates[0] ?? (matchCount % 2 === 1 ? -1 : 0)
      const evenCount = (matchCount + difference) / 2
      const evenIndices = Array.from({ length: evenCount }, (unused, index) => index * 2)
      const oddIndices = Array.from({ length: matchCount - evenCount }, (unused, index) => index * 2 + 1)
      return [...evenIndices, ...oddIndices].toSorted((a, b) => a - b)
    }

    const addLbRound = (entrants: LbEntrant[], nextUbLosers: number): LbEntrant[] => {
      const { pairs, leftover } = pairEntrants(entrants)
      if (pairs.length === 0) return leftover
      const round = lbRound++
      const destinationIndices = pickIndices(pairs.length, nextUbLosers, leftover)
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
        lbMap.set(`${round}_${destinationIndex}`, match)
      }

      matches.push(...roundMatches)
      const winners: LbEntrant[] = roundMatches.flatMap((m) =>
        m.round !== undefined && m.matchIndex !== undefined
          ? [{ kind: 'lb', round: m.round, matchIndex: m.matchIndex }]
          : []
      )
      return [...winners, ...leftover]
    }

    for (let round = 1; round <= upperRounds; round++) {
      const losers: LbEntrant[] = (ubByRound.get(round) ?? [])
        .filter(
          (m): m is GeneratedMatch & { matchIndex: number } =>
            m.matchIndex !== undefined && (round === 1 ? m.status !== MatchStatus.Bye : true)
        )
        .map((m) => ({ kind: 'ub', round, matchIndex: m.matchIndex }))
      const nextLosers = (ubByRound.get(round + 1) ?? []).length
      pending = addLbRound([...pending, ...losers], nextLosers)
    }

    while (pending.length >= 2) {
      pending = addLbRound(pending, 0)
    }

    // Grand finals
    const grandFinal = lbRound
    const ubFinal = (ubByRound.get(upperRounds) ?? [])[0] as GeneratedMatch | undefined
    if (ubFinal) ubFinal.winnerNext = { round: grandFinal, matchIndex: 0 }
    const firstPending = pending[0] as LbEntrant | undefined
    if (firstPending) linkSource(firstPending, grandFinal, 0)

    matches.push({
      tournamentId,
      round: grandFinal,
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

    return { totalRounds: grandFinal, matches }
  },

  advanceWinner(match: TournamentMatch, winnerId: number) {
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    return { winnerId, nextMatchId: match.nextMatchId ?? undefined, loserId: loserId ?? undefined }
  },

  isComplete(matches: TournamentMatch[]) {
    if (matches.length === 0) return false
    const finalRound = Math.max(...matches.map((m) => m.round))
    const grandFinal = matches.find((m) => m.round === finalRound)
    return grandFinal?.status === MatchStatus.Completed && grandFinal.winnerId !== undefined
  },

  championId(matches: TournamentMatch[]) {
    if (matches.length === 0) return
    const finalRound = Math.max(...matches.map((m) => m.round))
    return matches.find((m) => m.round === finalRound)?.winnerId
  },

  progressesRounds: () => false,
  eliminatesLoser: () => true
}

// round robin - everybody plays everybody once
const roundRobin: BracketStrategy = {
  name: 'round-robin',

  generate(tournamentId: number, players: TournamentPlayer[], roundDeadlineHours: number) {
    const playerCount = players.length
    if (playerCount < 2) return { totalRounds: 1, matches: [] }

    const now = Math.floor(Date.now() / 1000)
    const deadlineAt = now + roundDeadlineHours * 3600
    const matches: GeneratedMatch[] = []
    let matchIndex = 0

    for (let playerA = 0; playerA < playerCount; playerA++) {
      for (let playerB = playerA + 1; playerB < playerCount; playerB++) {
        matches.push({
          tournamentId,
          round: 1,
          matchIndex: matchIndex++,
          player1Id: players[playerA].id,
          player2Id: players[playerB].id,
          status: MatchStatus.Active,
          player1Wins: 0,
          player2Wins: 0,
          deadlineAt,
          completedAt: undefined
        })
      }
    }

    return { totalRounds: 1, matches }
  },

  advanceWinner(match: TournamentMatch, winnerId: number) {
    const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
    return { winnerId, loserId: loserId ?? undefined }
  },

  isComplete(matches: TournamentMatch[]) {
    return matches.every((m) => m.status === MatchStatus.Completed || m.status === MatchStatus.Bye)
  },

  championId(matches: TournamentMatch[]) {
    const scores = new Map<number, { wins: number; losses: number }>()
    for (const m of matches) {
      if (m.status !== MatchStatus.Completed) continue
      if (m.winnerId === undefined || m.player1Id === undefined || m.player2Id === undefined) continue

      const winnerRecord = scores.get(m.winnerId) ?? { wins: 0, losses: 0 }
      winnerRecord.wins++
      scores.set(m.winnerId, winnerRecord)

      const loserId = m.player1Id === m.winnerId ? m.player2Id : m.player1Id
      const loserRecord = scores.get(loserId) ?? { wins: 0, losses: 0 }
      loserRecord.losses++
      scores.set(loserId, loserRecord)
    }

    const sorted = [...scores.entries()].toSorted(([idA, a], [idB, b]) => {
      if (a.wins !== b.wins) return b.wins - a.wins
      if (a.losses !== b.losses) return a.losses - b.losses
      return idA - idB
    })
    return sorted[0]?.[0]
  },

  progressesRounds: () => false,
  eliminatesLoser: () => false
}

/* eslint-disable @typescript-eslint/naming-convention */
const formats: Record<string, BracketStrategy> = {
  'single-elim': singleElim,
  'double-elim': doubleElim,
  'round-robin': roundRobin
}
/* eslint-enable @typescript-eslint/naming-convention */

export class BracketGenerator {
  constructor(private readonly logger?: Logger) {}

  getStrategy(format: string): BracketStrategy {
    return formats[format] ?? singleElim
  }

  getSeedOrder(totalSlots: number): number[] {
    return getSeedOrder(totalSlots)
  }

  generateInitialMatches(
    tournamentId: number,
    players: TournamentPlayer[],
    roundDeadlineHours: number,
    format = 'single-elim'
  ): { totalRounds: number; matches: GeneratedMatch[] } {
    const handler = this.getStrategy(format)
    const result = handler.generate(tournamentId, players, roundDeadlineHours)
    return { totalRounds: result.totalRounds, matches: result.matches }
  }
}
