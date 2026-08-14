export const PartyInviteRegex = [
  /^(?:\[[+A-Z]{3,10}] ){0,3}(\w{3,32}) has invited you to join their party!/,
  /^You have been invited to join (?:\[[+A-Z]{3,10}] ){0,3}(\w{3,32})'s party!/
]

export const PartyJoinRegex = [
  /^Party created!/,
  /^You are now in a party with /,
  /^You (?:have )?joined (?:\[[+A-Z]{3,10}] )*\w{3,32}'s party!?/
]

/**
 * Message shown to the party leader when another player accepts the invite
 * and joins the party.
 */
export const PartyMemberJoinedRegex = [/^(?:\[[+A-Z]{3,10}] ){0,3}(\w{3,32}) joined the party!?/]

export function findPartyMemberJoined(message: string): string | undefined {
  for (const line of message.split('\n')) {
    for (const regex of PartyMemberJoinedRegex) {
      const match = regex.exec(line)
      if (match != undefined) return match[1]
    }
  }
  return undefined
}

export const PartyLeaveRegex = [
  /^You left the party\./,
  /^The party was disbanded\./,
  /^You have been kicked from the party\./
]

export function findPartyInvite(message: string): string | undefined {
  for (const line of message.split('\n')) {
    for (const regex of PartyInviteRegex) {
      const match = regex.exec(line)
      if (match != undefined) return match[1]
    }
  }
  return undefined
}

function matchesAny(message: string, regexes: RegExp[]): boolean {
  return message.split('\n').some((line) => regexes.some((regex) => regex.test(line)))
}

export function updatePartyState(message: string, current: boolean): boolean {
  if (matchesAny(message, PartyJoinRegex)) return true
  if (matchesAny(message, PartyLeaveRegex)) return false
  return current
}
