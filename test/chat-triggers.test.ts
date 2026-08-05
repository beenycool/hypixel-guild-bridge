import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  findPartyInvite,
  PartyInviteRegex,
  PartyJoinRegex,
  PartyLeaveRegex
} from '../src/instance/minecraft/chat/party-invite.js'
import {
  InviteAcceptChat,
  KickChat,
  MuteChat,
  PartyAcceptChat,
  PartyLeaveChat,
  PrivateMessageChat,
  RankChat,
  UnmuteChat
} from '../src/utility/chat-triggers.js'

await describe('RankChat triggers', async () => {
  await it('success pattern matches promotion', () => {
    const matched = RankChat.success.some((r) => r.test('[MVP+] Steve was promoted from Member to Officer'))
    assert.ok(matched)
  })

  await it('success pattern matches demotion', () => {
    const matched = RankChat.success.some((r) => r.test('Steve was demoted from Officer to Member'))
    assert.ok(matched)
  })

  await it('failure pattern matches rank not found', () => {
    const matched = RankChat.failure.some((r) => r.test("I couldn't find a rank by the name of 'foo'"))
    assert.ok(matched)
  })

  await it('failure pattern matches promote beyond own rank', () => {
    const matched = RankChat.failure.some((r) => r.test('You can only promote up to your own rank.'))
    assert.ok(matched)
  })

  await it('failure pattern matches already lowest rank', () => {
    const matched = RankChat.failure.some((r) => r.test("[MVP+] Steve is already the lowest rank you've created."))
    assert.ok(matched)
  })

  await it('failure pattern matches guild master promotion', () => {
    const matched = RankChat.failure.some((r) =>
      r.test("[MOD] Steve is the guild master so can't be promoted anymore!")
    )
    assert.ok(matched)
  })
})

await describe('KickChat triggers', async () => {
  await it('success pattern matches kick', () => {
    const matched = KickChat.success.some((r) => r.test('[MVP+] Steve was kicked from the guild by [MOD] Alex!'))
    assert.ok(matched)
  })

  await it('success pattern matches kick without rank', () => {
    const matched = KickChat.success.some((r) => r.test('Steve was kicked from the guild by Alex!'))
    assert.ok(matched)
  })

  await it('failure pattern matches invalid usage', () => {
    const matched = KickChat.failure.some((r) => r.test("Invalid usage! '/guild kick <player> <reason>'"))
    assert.ok(matched)
  })

  await it('failure pattern matches self-kick', () => {
    const matched = KickChat.failure.some((r) => r.test('You cannot kick yourself from the guild!'))
    assert.ok(matched)
  })

  await it('failure pattern matches no kick permission', () => {
    const matched = KickChat.failure.some((r) => r.test('You do not have permission to kick people from the guild!'))
    assert.ok(matched)
  })
})

await describe('MuteChat triggers', async () => {
  await it('success pattern matches player mute', () => {
    const matched = MuteChat.success.some((r) => r.test('[MOD] Alex has muted [MVP+] Steve for 1 hour'))
    assert.ok(matched)
  })

  await it('success pattern matches guild mute', () => {
    const matched = MuteChat.success.some((r) => r.test('Alex has muted the guild chat for 10 minutes'))
    assert.ok(matched)
  })

  await it('failure pattern matches invalid usage', () => {
    const matched = MuteChat.failure.some((r) => r.test("Invalid usage! '/guild mute <player/everyone> <time>'"))
    assert.ok(matched)
  })

  await it('failure pattern matches over-month mute', () => {
    const matched = MuteChat.failure.some((r) => r.test('You cannot mute someone for more than one month'))
    assert.ok(matched)
  })

  await it('failure pattern matches self-mute', () => {
    const matched = MuteChat.failure.some((r) => r.test('You cannot mute yourself from the guild!'))
    assert.ok(matched)
  })
})

await describe('UnmuteChat triggers', async () => {
  await it('success pattern matches player unmute', () => {
    const matched = UnmuteChat.success.some((r) => r.test('[MOD] Alex has unmuted [MVP+] Steve'))
    assert.ok(matched)
  })

  await it('success pattern matches guild unmute', () => {
    const matched = UnmuteChat.success.some((r) => r.test('Alex has unmuted the guild chat'))
    assert.ok(matched)
  })

  await it('failure pattern matches invalid usage', () => {
    const matched = UnmuteChat.failure.some((r) => r.test("Invalid usage! '/guild unmute <player/everyone>'"))
    assert.ok(matched)
  })

  await it('failure pattern matches not muted', () => {
    const matched = UnmuteChat.failure.some((r) => r.test('This player is not muted!'))
    assert.ok(matched)
  })

  await it('failure pattern matches guild not muted', () => {
    const matched = UnmuteChat.failure.some((r) => r.test('The guild is not muted!'))
    assert.ok(matched)
  })
})

await describe('InviteAcceptChat triggers', async () => {
  await it('success pattern matches invite sent', () => {
    const matched = InviteAcceptChat.success.some((r) =>
      r.test('You invited [MVP+] Steve to your guild. They have 5 minutes to accept')
    )
    assert.ok(matched)
  })

  await it('success pattern matches offline invite', () => {
    const matched = InviteAcceptChat.success.some((r) =>
      r.test('You sent an offline invite to Steve! They will have 5 minutes to accept once they come online!')
    )
    assert.ok(matched)
  })

  await it('success pattern matches duplicate invite', () => {
    const matched = InviteAcceptChat.success.some((r) =>
      r.test("You've already invited [MVP+] Steve to your guild! Wait for them to accept!")
    )
    assert.ok(matched)
  })

  await it('success pattern matches player join', () => {
    const matched = InviteAcceptChat.success.some((r) => r.test('[MVP+] Steve joined the guild!'))
    assert.ok(matched)
  })

  await it('success pattern matches own join', () => {
    const matched = InviteAcceptChat.success.some((r) => r.test('You joined The Guild!'))
    assert.ok(matched)
  })

  await it('failure pattern matches no invite permission', () => {
    const matched = InviteAcceptChat.failure.some((r) => r.test('You do not have permission to invite players!'))
    assert.ok(matched)
  })

  await it('failure pattern matches already in guild', () => {
    const matched = InviteAcceptChat.failure.some((r) => r.test('[MVP+] Steve is already in another guild!'))
    assert.ok(matched)
  })

  await it('failure pattern matches guild full', () => {
    const matched = InviteAcceptChat.failure.some((r) => r.test('Your guild is full!'))
    assert.ok(matched)
  })
})

await describe('PrivateMessageChat triggers', async () => {
  await it('success pattern matches outgoing PM', () => {
    const matched = PrivateMessageChat.success.some((r) => r.test('To [MVP+] Steve: hello there'))
    assert.ok(matched)
  })

  await it('success pattern matches PM with multiple ranks', () => {
    const matched = PrivateMessageChat.success.some((r) => r.test('To [MVP+] [MOD] [GM] Steve: hello there'))
    assert.ok(matched)
  })

  await it('failure pattern matches cannot message player', () => {
    const matched = PrivateMessageChat.failure.some((r) => r.test('You cannot message this player.'))
    assert.ok(matched)
  })

  await it('failure pattern matches duplicate message', () => {
    const matched = PrivateMessageChat.failure.some((r) => r.test('You cannot say the same message twice!'))
    assert.ok(matched)
  })

  await it('failure pattern matches player offline', () => {
    const matched = PrivateMessageChat.failure.some((r) => r.test('That player is not online!'))
    assert.ok(matched)
  })

  await it('does not match PM without rank', () => {
    const matched = PrivateMessageChat.success.some((r) => r.test('To Steve: hi'))
    assert.ok(!matched)
  })
})

await describe('PartyLeaveChat triggers', async () => {
  await it('success pattern matches leaving party', () => {
    const matched = PartyLeaveChat.success.some((r) => r.test('You left the party.'))
    assert.ok(matched)
  })

  await it('success pattern matches party disband', () => {
    const matched = PartyLeaveChat.success.some((r) => r.test('The party was disbanded.'))
    assert.ok(matched)
  })

  await it('success pattern matches being kicked', () => {
    const matched = PartyLeaveChat.success.some((r) => r.test('You have been kicked from the party.'))
    assert.ok(matched)
  })

  await it('failure pattern matches not in a party', () => {
    const matched = PartyLeaveChat.failure.some((r) => r.test('You are not in a party!'))
    assert.ok(matched)
  })
})

await describe('PartyAcceptChat triggers', async () => {
  await it('success pattern matches joining party', () => {
    const matched = PartyAcceptChat.success.some((r) => r.test('You are now in a party with Steve.'))
    assert.ok(matched)
  })

  await it('success pattern matches joining named party', () => {
    const matched = PartyAcceptChat.success.some((r) => r.test("You joined Steve's party."))
    assert.ok(matched)
  })

  await it('failure pattern matches already in a party', () => {
    const matched = PartyAcceptChat.failure.some((r) => r.test('You are already in a party!'))
    assert.ok(matched)
  })

  await it('failure pattern matches inviter offline', () => {
    const matched = PartyAcceptChat.failure.some((r) => r.test('Steve is not online!'))
    assert.ok(matched)
  })
})

await describe('Party invite detection regexes', async () => {
  await it('matches plain invite message', () => {
    const matched = PartyInviteRegex.some((r) => r.test('Steve has invited you to join their party!'))
    assert.ok(matched)
  })

  await it('matches invite with rank prefix', () => {
    const matched = PartyInviteRegex.some((r) => r.test('[MVP+] Steve has invited you to join their party!'))
    assert.ok(matched)
  })

  await it('matches newer invite phrasing', () => {
    const matched = PartyInviteRegex.some((r) => r.test("You have been invited to join Steve's party!"))
    assert.ok(matched)
  })

  await it('extracts inviter username', () => {
    const username = PartyInviteRegex.map((r) => r.exec('Steve has invited you to join their party!')).find(
      (m) => m != undefined
    )?.[1]
    assert.strictEqual(username, 'Steve')
  })

  await it('does not match unrelated messages', () => {
    const matched = PartyInviteRegex.some((r) => r.test('Guild > Steve: welcome to the guild!'))
    assert.ok(!matched)
  })

  await it('matches invite inside a Hypixel separator box', () => {
    const boxed = `-----------------------------------------------------\nSteve has invited you to join their party!\nYou have 60 seconds to accept. Click here to join!\n-----------------------------------------------------`
    assert.strictEqual(findPartyInvite(boxed), 'Steve')
  })

  await it('matches plain single-line invite', () => {
    assert.strictEqual(findPartyInvite('Steve has invited you to join their party!'), 'Steve')
  })

  await it('does not extract username from unrelated boxed message', () => {
    const boxed = `-----------------------------------------------------\nGuild > Steve: welcome!\n-----------------------------------------------------`
    assert.strictEqual(findPartyInvite(boxed), undefined)
  })
})

await describe('Party state regexes', async () => {
  await it('join regex matches created party', () => {
    assert.ok(PartyJoinRegex.some((r) => r.test('Party created!')))
  })

  await it('join regex matches now in party', () => {
    assert.ok(PartyJoinRegex.some((r) => r.test('You are now in a party with Steve.')))
  })

  await it('leave regex matches left party', () => {
    assert.ok(PartyLeaveRegex.some((r) => r.test('You left the party.')))
  })
})
