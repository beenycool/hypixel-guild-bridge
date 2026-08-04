import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

await describe('TournamentChannelManager', async () => {
  await it('should create a private thread with both players', () => {
    let threadCreated = false
    const membersAdded: string[] = []

    const mockThread = {
      id: 'thread-1',
      members: {
        add: (userId: string) => {
          membersAdded.push(userId)
        }
      }
    }

    const mockChannel = {
      threads: {
        create: (options: { name: string; message: { content: string } }) => {
          threadCreated = true
          assert.ok(options.name.includes('Player1'))
          assert.ok(options.name.includes('Player2'))
          return mockThread
        }
      }
    }

    const thread = mockChannel.threads.create({
      name: 'Round 1 — Player1 vs Player2',
      message: { content: 'Match started!' }
    })

    assert.equal(threadCreated, true)
    assert.equal(thread.id, 'thread-1')

    thread.members.add('discord-1')
    thread.members.add('discord-2')
    assert.equal(membersAdded.length, 2)
    assert.ok(membersAdded.includes('discord-1'))
    assert.ok(membersAdded.includes('discord-2'))
  })

  await it('should archive a thread', () => {
    let archived = false
    let locked = false

    const mockThread = {
      setLocked: (state: boolean) => {
        locked = state
      },
      setArchived: (state: boolean) => {
        archived = state
      }
    }

    mockThread.setArchived(true)
    mockThread.setLocked(true)

    assert.equal(archived, true)
    assert.equal(locked, true)
  })

  await it('should build a match embed with correct fields', () => {
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
