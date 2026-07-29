import assert from 'node:assert'
import { describe, it } from 'node:test'

import { GuildPlayerEventType } from '../src/common/application-event.js'
import { parseRankChange, RankCompactTracker } from '../src/instance/discord/common/rank-compact-tracker.js'

await describe('parseRankChange', async () => {
  await it('parses promotion message with rank prefix', () => {
    const result = parseRankChange('[MVP+] Steve was promoted from Member to Officer')
    assert.deepStrictEqual(result, { fromRank: 'Member', toRank: 'Officer' })
  })

  await it('parses promotion message without rank prefix', () => {
    const result = parseRankChange('Steve was promoted from Member to VIP')
    assert.deepStrictEqual(result, { fromRank: 'Member', toRank: 'VIP' })
  })

  await it('parses demotion message', () => {
    const result = parseRankChange('Steve was demoted from Officer to Member')
    assert.deepStrictEqual(result, { fromRank: 'Officer', toRank: 'Member' })
  })

  await it('returns undefined for non-rank-change messages', () => {
    const result = parseRankChange('Steve joined the guild!')
    assert.strictEqual(result, undefined)
  })
})

await describe('RankCompactTracker', async () => {
  await it('stores and retrieves rank compact entries', () => {
    const tracker = new RankCompactTracker()
    tracker.set('bridge1:uuid-123', {
      userId: 'uuid-123',
      initialRank: 'Member',
      currentRank: 'VIP',
      initialType: GuildPlayerEventType.Promote,
      timestamp: Date.now(),
      messages: []
    })

    const entry = tracker.get('bridge1:uuid-123')
    assert.ok(entry != undefined)
    assert.strictEqual(entry.initialRank, 'Member')
    assert.strictEqual(entry.currentRank, 'VIP')
  })

  await it('deletes entry when cleared or deleted', () => {
    const tracker = new RankCompactTracker()
    tracker.set('bridge1:uuid-123', {
      userId: 'uuid-123',
      initialRank: 'Member',
      currentRank: 'VIP',
      initialType: GuildPlayerEventType.Promote,
      timestamp: Date.now(),
      messages: []
    })

    tracker.delete('bridge1:uuid-123')
    assert.strictEqual(tracker.get('bridge1:uuid-123'), undefined)
  })
})
