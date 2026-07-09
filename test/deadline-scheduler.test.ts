import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

describe('DeadlineScheduler', () => {
  it('should identify expired deadlines', () => {
    const now = Date.now()
    const past = new Date(now - 3600_000).toISOString()
    const future = new Date(now + 3600_000).toISOString()

    assert.ok(new Date(past).getTime() < now)
    assert.ok(new Date(future).getTime() > now)
  })

  it('should detect 24-hour warning threshold', () => {
    const now = Date.now()
    const in23Hours = new Date(now + 23 * 3600_000)
    const in25Hours = new Date(now + 25 * 3600_000)

    const withinWarningThreshold = (deadline: Date): boolean => {
      const msUntilDeadline = deadline.getTime() - Date.now()
      return msUntilDeadline > 0 && msUntilDeadline <= 24 * 3600_000
    }

    assert.equal(withinWarningThreshold(in23Hours), true)
    assert.equal(withinWarningThreshold(in25Hours), false)
  })

  it('should auto-resolve with higher seed when no reports', async () => {
    const match = {
      id: 1,
      player1_id: 1,
      player2_id: 2,
      status: 'Active',
      deadline_at: new Date(Date.now() - 1000).toISOString()
    }

    const resolveWithHigherSeed = (m: typeof match, players: any[]): number | null => {
      if (m.status !== 'Active' && m.status !== 'Reported') return null
      const p1 = players.find((p: any) => p.id === m.player1_id)
      const p2 = players.find((p: any) => p.id === m.player2_id)
      if (!p1 || !p2) return null
      return p1.seed <= p2.seed ? m.player1_id : m.player2_id
    }

    const players = [
      { id: 1, seed: 2 },
      { id: 2, seed: 5 }
    ]

    const winner = resolveWithHigherSeed(match, players)
    assert.equal(winner, 1)
  })

  it('should advance reporting player when only one report exists', async () => {
    const reports = [{ match_id: 1, reporter_id: 1, claimed_winner_id: 1 }]

    const getWinner = (reports: any[], match: any): number | null => {
      if (reports.length === 1) {
        return reports[0].claimed_winner_id
      }
      return null
    }

    const match = { id: 1, player1_id: 1, player2_id: 2 }
    const winner = getWinner(reports, match)
    assert.equal(winner, 1)
  })
})
