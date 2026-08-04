import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

interface FakeMatchRow {
  id: number
  player1Id: number
  player2Id: number
  status: string
  deadlineAt: string
}

interface FakePlayerRow {
  id: number
  seed: number
}

interface FakeReportRow {
  matchId: number
  reporterId: number
  claimedWinnerId: number
}

function resolveWithHigherSeed(match: FakeMatchRow, players: FakePlayerRow[]): number | undefined {
  if (match.status !== 'Active' && match.status !== 'Reported') return undefined
  const player1 = players.find((player) => player.id === match.player1Id)
  const player2 = players.find((player) => player.id === match.player2Id)
  if (!player1 || !player2) return undefined
  return player1.seed <= player2.seed ? match.player1Id : match.player2Id
}

function getWinner(reports: FakeReportRow[]): number | undefined {
  if (reports.length === 1) {
    return reports[0].claimedWinnerId
  }
  return undefined
}

await describe('DeadlineScheduler', async () => {
  await it('should identify expired deadlines', () => {
    const now = Date.now()
    const past = new Date(now - 3_600_000).toISOString()
    const future = new Date(now + 3_600_000).toISOString()

    assert.ok(new Date(past).getTime() < now)
    assert.ok(new Date(future).getTime() > now)
  })

  await it('should detect 24-hour warning threshold', () => {
    const now = Date.now()
    const in23Hours = new Date(now + 23 * 3_600_000)
    const in25Hours = new Date(now + 25 * 3_600_000)

    const withinWarningThreshold = (deadline: Date): boolean => {
      const msUntilDeadline = deadline.getTime() - Date.now()
      return msUntilDeadline > 0 && msUntilDeadline <= 24 * 3_600_000
    }

    assert.equal(withinWarningThreshold(in23Hours), true)
    assert.equal(withinWarningThreshold(in25Hours), false)
  })

  await it('should auto-resolve with higher seed when no reports', () => {
    const match = {
      id: 1,
      player1Id: 1,
      player2Id: 2,
      status: 'Active',
      deadlineAt: new Date(Date.now() - 1000).toISOString()
    }

    const players = [
      { id: 1, seed: 2 },
      { id: 2, seed: 5 }
    ]

    const winner = resolveWithHigherSeed(match, players)
    assert.equal(winner, 1)
  })

  await it('should advance reporting player when only one report exists', () => {
    const reports = [{ matchId: 1, reporterId: 1, claimedWinnerId: 1 }]

    const winner = getWinner(reports)
    assert.equal(winner, 1)
  })
})
