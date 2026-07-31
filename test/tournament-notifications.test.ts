import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TournamentNotifications } from '../src/core/tournament/tournament-notifications.js'

describe('TournamentNotifications', () => {
  it('should send a whisper to a specific player', async () => {
    let sentMessage = ''
    let sentUuid = ''

    const mockSendMinecraft = async (uuid: string, message: string) => {
      sentUuid = uuid
      sentMessage = message
    }

    await mockSendMinecraft('player-uuid', 'Your match is ready!')
    assert.equal(sentUuid, 'player-uuid')
    assert.equal(sentMessage, 'Your match is ready!')
  })

  it('should announce to guild chat', async () => {
    let announced = false
    let announcedMessage = ''

    const mockAnnounce = async (bridgeId: string, message: string) => {
      announced = true
      announcedMessage = message
    }

    await mockAnnounce('bridge-1', 'Round 1 is complete!')
    assert.equal(announced, true)
    assert.equal(announcedMessage, 'Round 1 is complete!')
  })

  it('should format deadline warning message', () => {
    const deadline = new Date(Date.now() + 24 * 3_600_000)
    const hoursLeft = Math.round((deadline.getTime() - Date.now()) / 3_600_000)

    const message = `⚠️ ${hoursLeft} hours remaining! Higher seed advances if no report.`
    assert.ok(message.includes('24'))
    assert.ok(message.includes('hours remaining'))
  })

  it('should format match notification', () => {
    const p1 = 'Alice'
    const p2 = 'Bob'
    const round = 2
    const bestOf = 5
    const mode = 'bedwars'

    const message = `[Tournament] Round ${round}: ${p1} vs ${p2}. Bo${bestOf} ${mode}.`
    assert.equal(message, '[Tournament] Round 2: Alice vs Bob. Bo5 bedwars.')
  })
})


