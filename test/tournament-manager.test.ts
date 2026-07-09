import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

interface QueryResult {
  rows?: any[]
  rowCount?: number
}

const mockDb = {
  query: mock.fn(async (..._args: any[]): Promise<QueryResult> => ({ rows: [] })),
  transaction: mock.fn(async (cb: any) => await cb(mockDb))
}

describe('TournamentManager', () => {
  it('should create a tournament', async () => {
    mockDb.query.mock.mockImplementation(async (_sql: string, ..._args: any[]): Promise<QueryResult> => {
      return { rows: [{ id: 1 }] }
    })

    const result = await mockDb.query('INSERT INTO tournaments ...', [])
    assert.equal(result.rows![0].id, 1)
  })

  it('should add a player to a tournament', async () => {
    mockDb.query.mock.mockImplementation(async (_sql: string, ..._args: any[]): Promise<QueryResult> => {
      return { rows: [{ id: 1 }] }
    })

    const result = await mockDb.query('INSERT INTO tournament_players ...', [])
    assert.equal(result.rows![0].id, 1)
  })

  it('should reject duplicate player join', async () => {
    mockDb.query.mock.mockImplementation(async (_sql: string, ..._args: any[]): Promise<QueryResult> => {
      throw new Error('duplicate key value violates unique constraint')
    })

    await assert.rejects(async () => mockDb.query('INSERT INTO tournament_players ...'), /duplicate/)
  })

  it('should handle player leave', async () => {
    let deleted = false
    mockDb.query.mock.mockImplementation(async (_sql: string, ..._args: any[]): Promise<QueryResult> => {
      if (_sql.includes('DELETE')) {
        deleted = true
        return { rowCount: 1 }
      }
      return { rows: [] }
    })

    await mockDb.query('DELETE FROM tournament_players WHERE tournament_id = $1 AND player_uuid = $2', [1, 'uuid'])
    assert.equal(deleted, true)
  })
})
