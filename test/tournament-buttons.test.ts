import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ActionRowBuilder, ButtonStyle } from 'discord.js'
import type { ButtonBuilder, TextInputBuilder } from 'discord.js'

import { TournamentStatus } from '../src/core/tournament/types.js'
import type { Tournament } from '../src/core/tournament/types.js'
import {
  buildCheckinComponents,
  buildReportModal,
  buildSignupComponents,
  buildSignupEmbed,
  buildThreadComponents,
  CheckinAction,
  deriveWinner,
  ForfeitAction,
  ForfeitConfirmAction,
  JoinAction,
  LeaveAction,
  parseCustomId,
  Prefix,
  ReportAction
} from '../src/instance/discord/features/tournament-buttons.js'

function customIdOf(button: ButtonBuilder): string | undefined {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- discord.js wire-format field
  return (button.data as { custom_id?: string }).custom_id
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message)
  }
  return value
}

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 5,
    bridgeId: 'default',
    name: 'Summer Cup',
    gameType: 'Bridge',
    bestOf: 3,
    status: TournamentStatus.Signup,
    roundDeadlineHours: 48,
    createdBy: '1',
    winnerId: undefined,
    discordChannelId: undefined,
    bracketMessageId: undefined,
    categoryChannelId: undefined,
    liveChannelId: undefined,
    checkinOpensAt: undefined,
    checkinClosesAt: undefined,
    startedAtUnix: undefined,
    currentRound: 1,
    totalRounds: 1,
    createdAt: 1,
    startedAt: undefined,
    completedAt: undefined,
    ...overrides
  }
}

await describe('parseCustomId', async () => {
  await it('parses signup actions with tournamentId and messageId', () => {
    for (const action of [JoinAction, LeaveAction, CheckinAction]) {
      const parsed = requireValue(parseCustomId(`${Prefix}:${action}:12:123456789`), 'expected a parsed signup id')
      assert.equal(parsed.action, action)
      assert.equal(parsed.tournamentId, 12)
      assert.equal(parsed.messageId, '123456789')
    }
  })

  await it('parses match actions with matchId', () => {
    const report = requireValue(parseCustomId(`${Prefix}:${ReportAction}:42`), 'expected a parsed report id')
    assert.equal(report.action, ReportAction)
    assert.equal(report.matchId, 42)
    assert.equal(report.tournamentId, undefined)

    const forfeit = requireValue(parseCustomId(`${Prefix}:${ForfeitAction}:42`), 'expected a parsed forfeit id')
    assert.equal(forfeit.action, ForfeitAction)
    assert.equal(forfeit.matchId, 42)
  })

  await it('parses forfeit confirm with matchId and playerId', () => {
    const parsed = requireValue(
      parseCustomId(`${Prefix}:${ForfeitConfirmAction}:42:7`),
      'expected a parsed forfeit confirm id'
    )
    assert.equal(parsed.action, ForfeitConfirmAction)
    assert.equal(parsed.matchId, 42)
    assert.equal(parsed.playerId, 7)
  })

  await it('rejects customIds with the wrong prefix', () => {
    assert.equal(parseCustomId('other-prefix:join:12:m1'), undefined)
    assert.equal(parseCustomId(Prefix), undefined)
    assert.equal(parseCustomId(''), undefined)
  })

  await it('rejects malformed ids', () => {
    const parsed = requireValue(parseCustomId(`${Prefix}:${JoinAction}:abc:123`), 'expected a parsed malformed id')
    assert.equal(parsed.tournamentId, undefined)
    assert.equal(parsed.messageId, '123')

    const missing = requireValue(parseCustomId(`${Prefix}:${ReportAction}:`), 'expected a parsed empty report id')
    assert.equal(missing.matchId, undefined)
  })
})

await describe('buildSignupEmbed', async () => {
  await it('describes the button signup flow and participant count', () => {
    const tournament = makeTournament()
    const embed = buildSignupEmbed(tournament, 4)

    assert.equal(embed.data.title, 'Sign up for Summer Cup')
    assert.ok(embed.data.description?.includes('Click **Join** below to enter!'))
    assert.ok(embed.data.description?.includes('**Game:** Bridge'))
    assert.ok(embed.data.description?.includes('**Best of:** 3'))
    assert.ok(embed.data.description?.includes('**Participants:** 4'))
    assert.ok(embed.data.footer?.text.includes('Tournament ID: 5'))
  })

  await it('renders a zero participant count', () => {
    const embed = buildSignupEmbed(makeTournament(), 0)
    assert.ok(embed.data.description?.includes('**Participants:** 0'))
  })
})

await describe('buildSignupComponents', async () => {
  await it('builds Join and Leave buttons with full customIds', () => {
    const rows = buildSignupComponents(5, 'm1')
    assert.equal(rows.length, 1)

    const buttons = rows[0].components
    assert.equal(buttons.length, 2)
    assert.equal(customIdOf(buttons[0]), `${Prefix}:${JoinAction}:5:m1`)
    assert.equal(buttons[0].data.style, ButtonStyle.Success)
    assert.equal(customIdOf(buttons[1]), `${Prefix}:${LeaveAction}:5:m1`)
    assert.equal(buttons[1].data.style, ButtonStyle.Danger)
  })
})

await describe('buildCheckinComponents', async () => {
  await it('builds a Check In button with the message id', () => {
    const rows = buildCheckinComponents(5, 'm1')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].components.length, 1)
    assert.equal(customIdOf(rows[0].components[0]), `${Prefix}:${CheckinAction}:5:m1`)
  })
})

await describe('buildThreadComponents', async () => {
  await it('builds Report and Forfeit buttons for a match', () => {
    const rows = buildThreadComponents(9)
    assert.equal(rows.length, 1)

    const buttons = rows[0].components
    assert.equal(buttons.length, 2)
    assert.equal(customIdOf(buttons[0]), `${Prefix}:${ReportAction}:9`)
    assert.equal(customIdOf(buttons[1]), `${Prefix}:${ForfeitAction}:9`)
  })
})

await describe('buildReportModal', async () => {
  await it('uses the report customId and includes both score inputs', () => {
    const modal = buildReportModal(9)
    assert.equal(modal.data.custom_id, `${Prefix}:${ReportAction}:9`)
    const rows = modal.components.filter(
      (component): component is ActionRowBuilder<TextInputBuilder> => component instanceof ActionRowBuilder
    )
    assert.equal(rows.length, 2)
    assert.equal(rows[0].components[0].data.custom_id, 'my-wins')
    assert.equal(rows[1].components[0].data.custom_id, 'their-wins')
  })
})

await describe('deriveWinner', async () => {
  await it('awards the win to the reporter when their score is higher', () => {
    assert.equal(deriveWinner(2, 1, 10, 20), 10)
  })

  await it('awards the win to the opponent when their score is higher', () => {
    assert.equal(deriveWinner(0, 2, 10, 20), 20)
  })

  await it('returns undefined on a tie score', () => {
    assert.equal(deriveWinner(1, 1, 10, 20), undefined)
  })

  await it('is consistent with a reversed pair of scores', () => {
    assert.equal(deriveWinner(1, 2, 10, 20), 20)
    assert.equal(deriveWinner(2, 1, 20, 10), 20)
  })
})
