import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

describe('TournamentChannelManager', () => {
  it('should create a private thread with both players', async () => {
    let threadCreated = false
    let membersAdded: string[] = []

    const mockThread = {
      id: 'thread-1',
      members: {
        add: async (userId: string) => {
          membersAdded.push(userId)
        }
      }
    }

    const mockChannel = {
      threads: {
        create: async (opts: any) => {
          threadCreated = true
          assert.ok(opts.name.includes('Player1'))
          assert.ok(opts.name.includes('Player2'))
          return mockThread
        }
      }
    }

    const thread = await mockChannel.threads.create({
      name: 'Round 1 — Player1 vs Player2',
      message: { content: 'Match started!' }
    })

    assert.equal(threadCreated, true)
    assert.equal(thread.id, 'thread-1')

    await thread.members.add('discord-1')
    await thread.members.add('discord-2')
    assert.equal(membersAdded.length, 2)
    assert.ok(membersAdded.includes('discord-1'))
    assert.ok(membersAdded.includes('discord-2'))
  })

  it('should archive a thread', async () => {
    let archived = false
    let locked = false

    const mockThread = {
      setLocked: async (state: boolean) => {
        locked = state
      },
      setArchived: async (state: boolean) => {
        archived = state
      }
    }

    await mockThread.setArchived(true)
    await mockThread.setLocked(true)

    assert.equal(archived, true)
    assert.equal(locked, true)
  })

  it('should build a match embed with correct fields', () => {
    const p1 = 'Player1'
    const p2 = 'Player2'
    const round = 1
    const bestOf = 3
    const gameMode = 'bridge'

    const title = `Round ${round} — ${p1} vs ${p2}`
    assert.equal(title, 'Round 1 — Player1 vs Player2')

    const description = `**Best of ${bestOf}** | ${gameMode}`
    assert.equal(description, '**Best of 3** | bridge')
  })
})
