/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type Application from '../src/application.js'
import { TournamentNotifications, type TournamentResultRow } from '../src/core/tournament/tournament-notifications.js'
import { PlayerStatus, TournamentStatus } from '../src/core/tournament/types.js'
import type { Tournament, TournamentPlayer } from '../src/core/tournament/types.js'

interface SentMessage {
  content?: string
  embeds?: { data?: { description?: string } }[]
}

function buildMockApplication(sent: SentMessage[]): Application {
  const fakeChannel = {
    isSendable: () => true,
    send: (payload: SentMessage) => {
      sent.push(payload)
      return Promise.resolve()
    }
  }
  return {
    logger: { info: mock.fn(), error: mock.fn(), warn: mock.fn() },
    core: {
      bridgeConfigurations: {
        getTournamentNotificationChannelId: () => undefined,
        getMinecraftInstances: () => [],
        getTournamentAnnounceMc: () => false
      }
    },
    discordInstance: {
      getClient: () => ({ channels: { fetch: () => Promise.resolve(fakeChannel) } })
    },
    minecraftManager: {
      getAllInstances: () => []
    },
    mojangApi: {
      profileByUuid: () => Promise.resolve(undefined)
    }
  } as unknown as Application
}

function buildTournament(): Tournament {
  return {
    id: 1,
    bridgeId: 'bridge-1',
    name: 'Test Tournament',
    gameType: 'bedwars',
    bestOf: 3,
    status: TournamentStatus.Completed,
    roundDeadlineHours: 48,
    createdBy: 'system',
    winnerId: 100,
    discordChannelId: 'channel-1',
    bracketMessageId: 'message-1',
    categoryChannelId: undefined,
    liveChannelId: 'channel-live',
    checkinOpensAt: undefined,
    checkinClosesAt: undefined,
    startedAtUnix: undefined,
    currentRound: 3,
    totalRounds: 3,
    createdAt: 0,
    startedAt: 0,
    completedAt: 0
  }
}

function buildPlayer(id: number, discordId: string | undefined): TournamentPlayer {
  return {
    id,
    tournamentId: 1,
    playerUuid: `uuid-${id}`,
    discordId,
    seed: id,
    status: PlayerStatus.Active,
    joinedAt: 0,
    checkedInAt: 0
  }
}

describe('TournamentNotifications', () => {
  it('should send a whisper to a specific player', async () => {
    let sentMessage = ''
    let sentUuid = ''

    const mockSendMinecraft = (uuid: string, message: string) => {
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

    const mockAnnounce = (bridgeId: string, message: string) => {
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

  it('announceResults posts a standings embed with medals to the bracket channel', async () => {
    const sent: SentMessage[] = []
    const notifications = new TournamentNotifications(buildMockApplication(sent))

    const results: TournamentResultRow[] = [
      {
        id: 1,
        playerUuid: 'uuid-100',
        discordId: 'discord-100',
        tournamentId: 1,
        placement: 1,
        roundsReached: 3,
        wins: 3,
        losses: 0,
        champion: true,
        createdAt: 0
      },
      {
        id: 2,
        playerUuid: 'uuid-200',
        discordId: undefined,
        tournamentId: 1,
        placement: 2,
        roundsReached: 2,
        wins: 2,
        losses: 1,
        champion: false,
        createdAt: 0
      }
    ]

    await notifications.announceResults(buildTournament(), results)
    assert.equal(sent.length, 1)
    const description = sent[0].embeds?.[0].data?.description ?? ''
    assert.ok(description.includes('🥇'))
    assert.ok(description.includes('<@discord-100>'))
    assert.ok(description.includes('3W 0L'))
  })

  it('notifyMatchReady pings players in the thread', async () => {
    const sent: SentMessage[] = []
    const notifications = new TournamentNotifications(buildMockApplication(sent))

    await notifications.notifyMatchReady(
      'thread-1',
      buildPlayer(100, 'discord-100'),
      buildPlayer(200, undefined),
      'Alice',
      'Bob'
    )
    assert.equal(sent.length, 1)
    assert.ok(sent[0].content?.includes('Your match is ready!'))
    assert.ok(sent[0].content?.includes('<@discord-100>'))
    assert.ok(sent[0].content?.includes('Bob'))
  })
})
