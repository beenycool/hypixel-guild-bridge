import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  BracketGenerator,
  DoubleElimBracketStrategy,
  type GeneratedMatch,
  RoundRobinBracketStrategy
} from '../src/core/tournament/bracket-generator.js'
import { MatchStatus, type TournamentMatch, type TournamentPlayer } from '../src/core/tournament/types.js'

function makePlayer(id: number, seed: number): TournamentPlayer {
  return {
    id,
    tournamentId: 1,
    playerUuid: `uuid-${id}`,
    discordId: undefined,
    seed,
    status: 'REGISTERED' as any,
    joinedAt: 1000,
    checkedInAt: undefined
  }
}

function assertLinksValidAndParityCorrect(matches: GeneratedMatch[]): void {
  const byId = new Map<string, GeneratedMatch>()
  for (const m of matches) byId.set(`${m.round}_${m.matchIndex}`, m)

  const destinationSources = new Map<string, GeneratedMatch[]>()
  for (const m of matches) {
    for (const reference of [m.winnerNext, m.loserNext]) {
      if (reference === undefined) continue
      assert.ok(
        byId.has(`${reference.round}_${reference.matchIndex}`),
        `match ${m.round}_${m.matchIndex} links to missing ${reference.round}_${reference.matchIndex}`
      )
      const key = `${reference.round}_${reference.matchIndex}`
      const sources = destinationSources.get(key) ?? []
      sources.push(m)
      destinationSources.set(key, sources)
    }
  }

  for (const [destination, sources] of destinationSources) {
    assert.strictEqual(sources.length, 2, `destination ${destination} should have exactly 2 feeders`)
    const parities = sources.map((m) => m.matchIndex! % 2)
    assert.notStrictEqual(parities[0], parities[1], `destination ${destination} feeders must have opposite parity`)
  }
}

function assertMatchesComplete(matches: GeneratedMatch[]): void {
  for (const m of matches) {
    assert.ok(m.round !== undefined, 'every match must have a round')
    assert.ok(m.matchIndex !== undefined, 'every match must have a matchIndex')
    assert.ok(m.status !== undefined, 'every match must have a status')
  }
}

describe('BracketGenerator', () => {
  describe('getSeedOrder', () => {
    it('returns correct order for 4 slots', () => {
      const gen = new BracketGenerator()
      assert.deepStrictEqual(gen.getSeedOrder(4), [1, 4, 2, 3])
    })

    it('returns correct order for 8 slots', () => {
      const gen = new BracketGenerator()
      assert.deepStrictEqual(gen.getSeedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6])
    })

    it('returns correct order for 2 slots', () => {
      const gen = new BracketGenerator()
      assert.deepStrictEqual(gen.getSeedOrder(2), [1, 2])
    })
  })

  describe('generateInitialMatches', () => {
    it('creates 0 byes for exactly 4 players (power of 2)', () => {
      const gen = new BracketGenerator()
      const players = [1, 2, 3, 4].map((s) => makePlayer(s, s))
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48)
      assert.strictEqual(totalRounds, 2)
      const round1 = matches.filter((m) => m.round === 1)
      assert.strictEqual(round1.length, 2)
      assert.ok(round1.every((m) => m.status === MatchStatus.Active))
      assert.strictEqual(round1.filter((m) => m.status === MatchStatus.Bye).length, 0)
    })

    it('gives 1 bye for 15 players (top seed 1 gets bye)', () => {
      const gen = new BracketGenerator()
      const players = Array.from({ length: 15 }, (_, index) => makePlayer(index + 1, index + 1))
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48)
      assert.strictEqual(totalRounds, 4)
      const round1 = matches.filter((m) => m.round === 1)
      assert.strictEqual(round1.length, 8)
      const byes = round1.filter((m) => m.status === MatchStatus.Bye)
      assert.strictEqual(byes.length, 1)
      assert.ok(byes[0].winnerId !== undefined)
      const active = round1.filter((m) => m.status === MatchStatus.Active)
      assert.strictEqual(active.length, 7)
    })

    it('gives 2 byes for 6 players (top seeds seeded against bye slots)', () => {
      const gen = new BracketGenerator()
      const players = Array.from({ length: 6 }, (_, index) => makePlayer(index + 1, index + 1))
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48)
      assert.strictEqual(totalRounds, 3)
      const round1 = matches.filter((m) => m.round === 1)
      assert.strictEqual(round1.length, 4)
      const byes = round1.filter((m) => m.status === MatchStatus.Bye)
      assert.strictEqual(byes.length, 2)
      const active = round1.filter((m) => m.status === MatchStatus.Active)
      assert.strictEqual(active.length, 2)
    })

    it('handles 2 players minimum', () => {
      const gen = new BracketGenerator()
      const players = [makePlayer(1, 1), makePlayer(2, 2)]
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48)
      assert.strictEqual(totalRounds, 1)
      assert.strictEqual(matches.length, 1)
      assert.strictEqual(matches[0].status, MatchStatus.Active)
    })

    it('throws for less than 2 players', () => {
      const gen = new BracketGenerator()
      assert.throws(() => gen.generateInitialMatches(1, [makePlayer(1, 1)], 48), /less than 2 players/)
    })

    it('sets nextMatchId correctly for 4 players (2 rounds)', () => {
      const gen = new BracketGenerator()
      const players = [makePlayer(1, 1), makePlayer(2, 2), makePlayer(3, 3), makePlayer(4, 4)]
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48)
      const round1 = matches.filter((m) => m.round === 1)
      const round2 = matches.filter((m) => m.round === 2)
      assert.strictEqual(round1.length, 2)
      assert.strictEqual(round2.length, 1)
    })

    it('round-trip: final match exists and has no nextMatchId', () => {
      const gen = new BracketGenerator()
      const players = Array.from({ length: 8 }, (_, index) => makePlayer(index + 1, index + 1))
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48)
      const finals = matches.filter((m) => m.round === totalRounds)
      assert.strictEqual(finals.length, 1)
    })
  })

  describe('double-elim', () => {
    it('generates a correct bracket for 4 players', () => {
      const gen = new BracketGenerator()
      const players = [1, 2, 3, 4].map((s) => makePlayer(s, s))
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48, 'double-elim')
      assert.strictEqual(matches.length, 6)
      assert.strictEqual(totalRounds, 5)
      assertMatchesComplete(matches)

      const round1 = matches.filter((m) => m.round === 1)
      assert.strictEqual(round1.length, 2)
      assert.ok(round1.every((m) => m.status === MatchStatus.Active))

      const finalRound = matches.filter((m) => m.round === totalRounds)
      assert.strictEqual(finalRound.length, 1)
      const grandFinal = finalRound[0]
      assert.strictEqual(grandFinal.winnerNext, undefined)
      assert.strictEqual(grandFinal.loserNext, undefined)

      const linked = matches.filter((m) => m.winnerNext !== undefined || m.loserNext !== undefined)
      assert.strictEqual(linked.length, matches.length - 1)
      assertLinksValidAndParityCorrect(matches)
    })

    it('generates a correct bracket for 8 players', () => {
      const gen = new BracketGenerator()
      const players = Array.from({ length: 8 }, (_, index) => makePlayer(index + 1, index + 1))
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48, 'double-elim')
      assert.strictEqual(matches.length, 14)
      assert.strictEqual(totalRounds, 8)
      assertMatchesComplete(matches)

      const round1 = matches.filter((m) => m.round === 1)
      assert.strictEqual(round1.length, 4)
      assert.ok(round1.every((m) => m.status === MatchStatus.Active))

      const finalRound = matches.filter((m) => m.round === totalRounds)
      assert.strictEqual(finalRound.length, 1)
      assert.strictEqual(finalRound[0].winnerNext, undefined)
      assert.strictEqual(finalRound[0].loserNext, undefined)

      const linked = matches.filter((m) => m.winnerNext !== undefined || m.loserNext !== undefined)
      assert.strictEqual(linked.length, matches.length - 1)
      assertLinksValidAndParityCorrect(matches)
    })

    it('handles non-power-of-2 player counts with byes', () => {
      const gen = new BracketGenerator()
      const players = Array.from({ length: 6 }, (_, index) => makePlayer(index + 1, index + 1))
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48, 'double-elim')
      assertMatchesComplete(matches)
      assert.strictEqual(totalRounds, 8)
      assert.strictEqual(matches.length, 12)

      const round1 = matches.filter((m) => m.round === 1)
      const byes = round1.filter((m) => m.status === MatchStatus.Bye)
      assert.strictEqual(byes.length, 2)
      assert.ok(byes.every((m) => m.winnerId !== undefined))
      assert.ok(
        byes.every((m) => m.winnerNext !== undefined),
        'bye winners must advance via winnerNext'
      )

      const grandFinals = matches.filter((m) => m.round === totalRounds)
      assert.strictEqual(grandFinals.length, 1)

      const byId = new Map<string, GeneratedMatch>()
      for (const m of matches) byId.set(`${m.round}_${m.matchIndex}`, m)
      for (const m of matches) {
        for (const reference of [m.winnerNext, m.loserNext]) {
          if (reference === undefined) continue
          assert.ok(
            byId.has(`${reference.round}_${reference.matchIndex}`),
            `match ${m.round}_${m.matchIndex} links to missing ${reference.round}_${reference.matchIndex}`
          )
        }
      }
    })

    it('isComplete requires the grand final to be completed', () => {
      const strategy = new DoubleElimBracketStrategy()
      const makeMatch = (id: number, round: number, status: MatchStatus, winnerId?: number): TournamentMatch =>
        ({
          id,
          tournamentId: 1,
          round,
          matchIndex: 0,
          player1Id: 1,
          player2Id: 2,
          winnerId,
          nextMatchId: undefined,
          loserNextMatchId: undefined,
          status,
          player1Wins: 0,
          player2Wins: 0,
          discordThreadId: undefined,
          deadlineAt: 0,
          warningsSent: 0,
          completedAt: 0,
          deadlineExtensionMinutes: 0,
          manuallyExtended: false,
          hadProofAttachment: false
        }) as TournamentMatch
      const matches = [makeMatch(1, 1, MatchStatus.Completed, 1), makeMatch(2, 8, MatchStatus.Active)]
      assert.ok(!strategy.isComplete(matches))
      matches[1] = makeMatch(2, 8, MatchStatus.Completed, 2)
      assert.ok(strategy.isComplete(matches))
    })

    it('does not progress rounds', () => {
      const strategy = new DoubleElimBracketStrategy()
      assert.strictEqual(strategy.progressesRounds(), false)
      assert.strictEqual(strategy.eliminatesLoser(), true)
    })
  })

  describe('round-robin', () => {
    it('generates one match per pair in a single round with no links', () => {
      const gen = new BracketGenerator()
      const players = [1, 2, 3, 4].map((s) => makePlayer(s, s))
      const { totalRounds, matches } = gen.generateInitialMatches(1, players, 48, 'round-robin')
      assert.strictEqual(totalRounds, 1)
      assert.strictEqual(matches.length, 6)
      for (const m of matches) {
        assert.strictEqual(m.round, 1)
        assert.strictEqual(m.winnerNext, undefined)
        assert.strictEqual(m.loserNext, undefined)
        assert.strictEqual(m.status, MatchStatus.Active)
        assert.ok(m.player1Id !== undefined && m.player2Id !== undefined)
      }
      const indices = matches.map((m) => m.matchIndex)
      assert.deepStrictEqual(indices, [0, 1, 2, 3, 4, 5])
    })

    it('never eliminates losers and never progresses rounds', () => {
      const strategy = new RoundRobinBracketStrategy()
      assert.strictEqual(strategy.eliminatesLoser(), false)
      assert.strictEqual(strategy.progressesRounds(), false)
    })

    it('computes the champion from standings (wins desc, losses asc, playerId asc)', () => {
      const strategy = new RoundRobinBracketStrategy()
      const makeMatch = (id: number, p1: number, p2: number, winnerId: number): TournamentMatch =>
        ({
          id,
          tournamentId: 1,
          round: 1,
          matchIndex: id,
          player1Id: p1,
          player2Id: p2,
          winnerId,
          nextMatchId: undefined,
          loserNextMatchId: undefined,
          status: MatchStatus.Completed,
          player1Wins: 0,
          player2Wins: 0,
          discordThreadId: undefined,
          deadlineAt: 0,
          warningsSent: 0,
          completedAt: 0,
          deadlineExtensionMinutes: 0,
          manuallyExtended: false,
          hadProofAttachment: false
        }) as TournamentMatch
      const matches = [makeMatch(1, 100, 200, 100), makeMatch(2, 100, 300, 100), makeMatch(3, 200, 300, 200)]
      assert.strictEqual(strategy.championId(matches), 100)
    })

    it('breaks standings ties by playerId', () => {
      const strategy = new RoundRobinBracketStrategy()
      const makeMatch = (id: number, p1: number, p2: number, winnerId: number): TournamentMatch =>
        ({
          id,
          tournamentId: 1,
          round: 1,
          matchIndex: id,
          player1Id: p1,
          player2Id: p2,
          winnerId,
          nextMatchId: undefined,
          loserNextMatchId: undefined,
          status: MatchStatus.Completed,
          player1Wins: 0,
          player2Wins: 0,
          discordThreadId: undefined,
          deadlineAt: 0,
          warningsSent: 0,
          completedAt: 0,
          deadlineExtensionMinutes: 0,
          manuallyExtended: false,
          hadProofAttachment: false
        }) as TournamentMatch
      const matches = [makeMatch(1, 100, 200, 100), makeMatch(2, 200, 300, 200), makeMatch(3, 300, 100, 300)]
      assert.strictEqual(strategy.championId(matches), 100)
    })
  })
})
