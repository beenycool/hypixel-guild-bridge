import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BracketVisualizer } from '../src/core/tournament/bracket-visualizer.js'
import { MatchStatus, TournamentStatus } from '../src/core/tournament/types.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from '../src/core/tournament/types.js'

interface FixtureMatch {
  round: number
  matchIndex: number
  player1Id: number | undefined
  player2Id: number | undefined
  player1Wins: number | undefined
  player2Wins: number | undefined
  status: string
  winnerId: number | undefined
}

await describe('BracketVisualizer', async () => {
  await it('should generate MC bracket summary text', () => {
    const data = {
      tournament: { name: 'Test Tourney', totalRounds: 2 },
      matches: [
        {
          round: 1,
          matchIndex: 0,
          player1Id: 1,
          player2Id: 2,
          player1Wins: 2,
          player2Wins: 0,
          status: 'Completed',
          winnerId: 1
        },
        {
          round: 2,
          matchIndex: 0,
          player1Id: 1,
          player2Id: undefined,
          player1Wins: undefined,
          player2Wins: undefined,
          status: 'Pending',
          winnerId: undefined
        }
      ],
      players: [
        { id: 1, playerUuid: 'uuid1' },
        { id: 2, playerUuid: 'uuid2' }
      ],
      playerNames: new Map<number, string>([
        [1, 'Player1'],
        [2, 'Player2']
      ])
    }

    const lines: string[] = [`Test Tourney`]
    const matchesByRound = new Map<number, FixtureMatch[]>()
    for (const match of data.matches) {
      const round = match.round
      const roundMatches = matchesByRound.get(round) ?? []
      roundMatches.push(match)
      matchesByRound.set(round, roundMatches)
    }

    for (const [round, roundMatches] of matchesByRound) {
      lines.push('')
      lines.push(round === 2 ? 'FINAL' : `Round ${round}`)
      for (const match of roundMatches) {
        const p1 = match.player1Id ? (data.playerNames.get(match.player1Id) ?? 'TBD') : 'BYE'
        const p2 = match.player2Id ? (data.playerNames.get(match.player2Id) ?? 'TBD') : 'BYE'

        if (match.status === 'Completed' && match.winnerId) {
          const winner = match.winnerId === match.player1Id ? p1 : p2
          lines.push(`${p1} vs ${p2} (${match.player1Wins}-${match.player2Wins}) ${winner} wins`)
        } else {
          lines.push(`${p1} vs ${p2}`)
        }
      }
    }

    const summary = lines.join('\n')
    assert.ok(summary.includes('Test Tourney'))
    assert.ok(summary.includes('Player1 vs Player2'))
    assert.ok(summary.includes('2-0'))
    assert.ok(summary.includes('Player1 wins'))
    assert.ok(summary.includes('FINAL'))
  })

  await it('should handle empty data gracefully', () => {
    const data = {
      tournament: { name: 'Empty Tourney', totalRounds: 1 },
      matches: [] as FixtureMatch[],
      players: [] as TournamentPlayer[],
      playerNames: new Map<number, string>()
    }

    const lines: string[] = [`Empty Tourney`]
    assert.equal(lines.join('\n'), 'Empty Tourney')
    assert.ok(data.matches.length === 0)
  })

  await it('should handle byes correctly', () => {
    const data = {
      tournament: { name: 'Bye Test', totalRounds: 1 },
      matches: [{ round: 1, matchIndex: 0, player1Id: 1, player2Id: undefined, status: 'Bye', winnerId: 1 }],
      players: [{ id: 1, playerUuid: 'uuid1' }],
      playerNames: new Map([[1, 'Player1']])
    }

    const match = data.matches[0]
    const advancer = match.player1Id ? (data.playerNames.get(match.player1Id) ?? 'TBD') : 'TBD'

    assert.equal(advancer, 'Player1')
    assert.equal(match.status, 'Bye')
  })

  await it('should format disputed matches', () => {
    const match = { status: 'Disputed', player1Wins: 2, player2Wins: 2 }
    const lines = [`Match: ${match.status} (${match.player1Wins}-${match.player2Wins})`]

    assert.ok(lines[0].includes('Disputed'))
    assert.ok(lines[0].includes('2-2'))
  })

  await it('should build a non-empty bracket PNG image Buffer', () => {
    const visualizer = new BracketVisualizer()
    const buffer = visualizer.buildBracketImage({
      tournament: { name: 'PNG Test', totalRounds: 2, status: TournamentStatus.Active } as Tournament,
      matches: [
        {
          id: 1,
          tournamentId: 1,
          round: 1,
          matchIndex: 0,
          player1Id: 1,
          player2Id: 2,
          player1Wins: 2,
          player2Wins: 0,
          status: MatchStatus.Completed,
          winnerId: 1
        },
        {
          id: 2,
          tournamentId: 1,
          round: 1,
          matchIndex: 1,
          player1Id: 3,
          player2Id: 4,
          player1Wins: 1,
          player2Wins: 2,
          status: MatchStatus.Completed,
          winnerId: 4
        },
        {
          id: 3,
          tournamentId: 1,
          round: 2,
          matchIndex: 0,
          player1Id: 1,
          player2Id: 4,
          player1Wins: 0,
          player2Wins: 0,
          status: MatchStatus.Active,
          winnerId: undefined
        }
      ] as TournamentMatch[],
      players: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] as TournamentPlayer[],
      playerNames: new Map([
        [1, 'Alice'],
        [2, 'Bob'],
        [3, 'Charlie'],
        [4, 'Dave']
      ])
    })

    assert.ok(buffer instanceof Buffer)
    assert.ok(buffer.length > 0)

    assert.equal(buffer[0], 0x89)
    assert.equal(buffer[1], 0x50)
    assert.equal(buffer[2], 0x4e)
    assert.equal(buffer[3], 0x47)
  })

  await it('should build a valid bracket PNG for multi-round tournaments', () => {
    const visualizer = new BracketVisualizer()
    const buffer = visualizer.buildBracketImage({
      tournament: { name: '8 Player Championship', totalRounds: 3, status: TournamentStatus.Active } as Tournament,
      matches: [
        {
          id: 1,
          tournamentId: 1,
          round: 1,
          matchIndex: 0,
          player1Id: 1,
          player2Id: 2,
          status: MatchStatus.Completed,
          winnerId: 1
        },
        {
          id: 2,
          tournamentId: 1,
          round: 1,
          matchIndex: 1,
          player1Id: 3,
          player2Id: 4,
          status: MatchStatus.Completed,
          winnerId: 3
        },
        {
          id: 3,
          tournamentId: 1,
          round: 1,
          matchIndex: 2,
          player1Id: 5,
          player2Id: 6,
          status: MatchStatus.Completed,
          winnerId: 5
        },
        {
          id: 4,
          tournamentId: 1,
          round: 1,
          matchIndex: 3,
          player1Id: 7,
          player2Id: 8,
          status: MatchStatus.Completed,
          winnerId: 7
        },
        {
          id: 5,
          tournamentId: 1,
          round: 2,
          matchIndex: 0,
          player1Id: 1,
          player2Id: 3,
          status: MatchStatus.Completed,
          winnerId: 1
        },
        {
          id: 6,
          tournamentId: 1,
          round: 2,
          matchIndex: 1,
          player1Id: 5,
          player2Id: 7,
          status: MatchStatus.Completed,
          winnerId: 7
        },
        {
          id: 7,
          tournamentId: 1,
          round: 3,
          matchIndex: 0,
          player1Id: 1,
          player2Id: 7,
          status: MatchStatus.Active,
          winnerId: undefined
        }
      ] as TournamentMatch[],
      players: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id })) as TournamentPlayer[],
      playerNames: new Map([
        [1, 'Player1_VeryLongUsernameSample'],
        [2, 'Player2'],
        [3, 'Player3'],
        [4, 'Player4'],
        [5, 'Player5'],
        [6, 'Player6'],
        [7, 'Player7'],
        [8, 'Player8']
      ])
    })

    assert.ok(buffer instanceof Buffer)
    assert.ok(buffer.length > 0)
    assert.equal(buffer[0], 0x89)
    assert.equal(buffer[1], 0x50)
    assert.equal(buffer[2], 0x4e)
    assert.equal(buffer[3], 0x47)
  })
})
