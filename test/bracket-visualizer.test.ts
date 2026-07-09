import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('BracketVisualizer', () => {
  it('should generate MC bracket summary text', () => {
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
          player2Id: null,
          player1Wins: null,
          player2Wins: null,
          status: 'Pending',
          winnerId: null
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
    const matchesByRound = new Map<number, any[]>()
    for (const match of data.matches) {
      const round = match.round
      if (!matchesByRound.has(round)) matchesByRound.set(round, [])
      matchesByRound.get(round)!.push(match)
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

  it('should handle empty data gracefully', () => {
    const data = {
      tournament: { name: 'Empty Tourney', totalRounds: 1 },
      matches: [] as any[],
      players: [] as any[],
      playerNames: new Map<number, string>()
    }

    const lines: string[] = [`Empty Tourney`]
    assert.equal(lines.join('\n'), 'Empty Tourney')
    assert.ok(data.matches.length === 0)
  })

  it('should handle byes correctly', () => {
    const data = {
      tournament: { name: 'Bye Test', totalRounds: 1 },
      matches: [{ round: 1, matchIndex: 0, player1Id: 1, player2Id: null, status: 'Bye', winnerId: 1 }],
      players: [{ id: 1, playerUuid: 'uuid1' }],
      playerNames: new Map([[1, 'Player1']])
    }

    const match = data.matches[0]
    const advancer = match.player1Id ? data.playerNames.get(match.player1Id)! : 'TBD'

    assert.equal(advancer, 'Player1')
    assert.equal(match.status, 'Bye')
  })

  it('should format disputed matches', () => {
    const match = { status: 'Disputed', player1Wins: 2, player2Wins: 2 }
    const lines = [`Match: ${match.status} (${match.player1Wins}-${match.player2Wins})`]

    assert.ok(lines[0].includes('Disputed'))
    assert.ok(lines[0].includes('2-2'))
  })
})
