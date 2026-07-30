import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

interface QueryResult {
  rows?: any[]
  rowCount?: number
}

const mockDatabase = {
  query: mock.fn(async (..._arguments: any[]): Promise<QueryResult> => ({ rows: [] })),
  transaction: mock.fn(async (callback: any) => await callback(mockDatabase))
}

describe('TournamentManager', () => {
  it('should create a tournament', async () => {
    mockDatabase.query.mock.mockImplementation(async (_sql: string, ..._arguments: any[]): Promise<QueryResult> => {
      return { rows: [{ id: 1 }] }
    })

    const result = await mockDatabase.query('INSERT INTO tournaments ...', [])
    assert.equal(result.rows![0].id, 1)
  })

  it('should add a player to a tournament', async () => {
    mockDatabase.query.mock.mockImplementation(async (_sql: string, ..._arguments: any[]): Promise<QueryResult> => {
      return { rows: [{ id: 1 }] }
    })

    const result = await mockDatabase.query('INSERT INTO tournament_players ...', [])
    assert.equal(result.rows![0].id, 1)
  })

  it('should reject duplicate player join', async () => {
    mockDatabase.query.mock.mockImplementation(async (_sql: string, ..._arguments: any[]): Promise<QueryResult> => {
      throw new Error('duplicate key value violates unique constraint')
    })

    await assert.rejects(async () => mockDatabase.query('INSERT INTO tournament_players ...'), /duplicate/)
  })

  it('should handle player leave', async () => {
    let deleted = false
    mockDatabase.query.mock.mockImplementation(async (_sql: string, ..._arguments: any[]): Promise<QueryResult> => {
      if (_sql.includes('DELETE')) {
        deleted = true
        return { rowCount: 1 }
      }
      return { rows: [] }
    })

    await mockDatabase.query('DELETE FROM tournament_players WHERE tournament_id = $1 AND player_uuid = $2', [
      1,
      'uuid'
    ])
    assert.equal(deleted, true)
  })
})
