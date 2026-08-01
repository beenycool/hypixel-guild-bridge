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
  return (button.data as { custom_id?: string }).custom_id
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

describe('parseCustomId', () => {
  it('parses signup actions with tournamentId and messageId', () => {
    for (const action of [JoinAction, LeaveAction, CheckinAction]) {
      const parsed = parseCustomId(`${Prefix}:${action}:12:123456789`)
      assert.notEqual(parsed, undefined)
      assert.equal(parsed?.action, action)
      assert.equal(parsed?.tournamentId, 12)
      assert.equal(parsed?.messageId, '123456789')
    }
  })

  it('parses match actions with matchId', () => {
    const report = parseCustomId(`${Prefix}:${ReportAction}:42`)
    assert.notEqual(report, undefined)
    assert.equal(report?.action, ReportAction)
    assert.equal(report?.matchId, 42)
    assert.equal(report?.tournamentId, undefined)

    const forfeit = parseCustomId(`${Prefix}:${ForfeitAction}:42`)
    assert.notEqual(forfeit, undefined)
    assert.equal(forfeit?.action, ForfeitAction)
    assert.equal(forfeit?.matchId, 42)
  })

  it('parses forfeit confirm with matchId and playerId', () => {
    const parsed = parseCustomId(`${Prefix}:${ForfeitConfirmAction}:42:7`)
    assert.notEqual(parsed, undefined)
    assert.equal(parsed?.action, ForfeitConfirmAction)
    assert.equal(parsed?.matchId, 42)
    assert.equal(parsed?.playerId, 7)
  })

  it('rejects customIds with the wrong prefix', () => {
    assert.equal(parseCustomId('other-prefix:join:12:m1'), undefined)
    assert.equal(parseCustomId(Prefix), undefined)
    assert.equal(parseCustomId(''), undefined)
  })

  it('rejects malformed ids', () => {
    const parsed = parseCustomId(`${Prefix}:${JoinAction}:abc:123`)
    assert.notEqual(parsed, undefined)
    assert.equal(parsed?.tournamentId, undefined)
    assert.equal(parsed?.messageId, '123')

    const missing = parseCustomId(`${Prefix}:${ReportAction}:`)
    assert.notEqual(missing, undefined)
    assert.equal(missing?.matchId, undefined)
  })
})

describe('buildSignupEmbed', () => {
  it('describes the button signup flow and participant count', () => {
    const tournament = makeTournament()
    const embed = buildSignupEmbed(tournament, 4)

    assert.equal(embed.data.title, 'Sign up for Summer Cup')
    assert.ok(embed.data.description?.includes('Click **Join** below to enter!'))
    assert.ok(embed.data.description?.includes('**Game:** Bridge'))
    assert.ok(embed.data.description?.includes('**Best of:** 3'))
    assert.ok(embed.data.description?.includes('**Participants:** 4'))
    assert.ok(embed.data.footer?.text.includes('Tournament ID: 5'))
  })

  it('renders a zero participant count', () => {
    const embed = buildSignupEmbed(makeTournament(), 0)
    assert.ok(embed.data.description?.includes('**Participants:** 0'))
  })
})

describe('buildSignupComponents', () => {
  it('builds Join and Leave buttons with full customIds', () => {
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

describe('buildCheckinComponents', () => {
  it('builds a Check In button with the message id', () => {
    const rows = buildCheckinComponents(5, 'm1')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].components.length, 1)
    assert.equal(customIdOf(rows[0].components[0]), `${Prefix}:${CheckinAction}:5:m1`)
  })
})

describe('buildThreadComponents', () => {
  it('builds Report and Forfeit buttons for a match', () => {
    const rows = buildThreadComponents(9)
    assert.equal(rows.length, 1)

    const buttons = rows[0].components
    assert.equal(buttons.length, 2)
    assert.equal(customIdOf(buttons[0]), `${Prefix}:${ReportAction}:9`)
    assert.equal(customIdOf(buttons[1]), `${Prefix}:${ForfeitAction}:9`)
  })
})

describe('buildReportModal', () => {
  it('uses the report customId and includes both score inputs', () => {
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

describe('deriveWinner', () => {
  it('awards the win to the reporter when their score is higher', () => {
    assert.equal(deriveWinner(2, 1, 10, 20), 10)
  })

  it('awards the win to the opponent when their score is higher', () => {
    assert.equal(deriveWinner(0, 2, 10, 20), 20)
  })

  it('returns undefined on a tie score', () => {
    assert.equal(deriveWinner(1, 1, 10, 20), undefined)
  })

  it('is consistent with a reversed pair of scores', () => {
    assert.equal(deriveWinner(1, 2, 10, 20), 20)
    assert.equal(deriveWinner(2, 1, 20, 10), 20)
  })
})
