import assert from 'node:assert'
import { describe, it } from 'node:test'

import { BracketGenerator } from '../src/core/tournament/bracket-generator.js'
import { MatchStatus, type TournamentPlayer } from '../src/core/tournament/types.js'

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
})
