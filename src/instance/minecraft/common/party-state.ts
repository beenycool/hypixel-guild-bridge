export const PartyInviteRegex = [
  /^(?:\[[+A-Z]{3,10}] ){0,3}(\w{3,32}) has invited you to join their party!/,
  /^You have been invited to join (?:\[[+A-Z]{3,10}] ){0,3}(\w{3,32})'s party!/
]

export const PartyJoinRegex = [/^Party created!/, /^You are now in a party with /, /^You joined .*'s party\./]

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
