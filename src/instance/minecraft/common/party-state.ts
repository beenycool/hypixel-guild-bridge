export const PartyInviteRegex = [
  /^(?:\[[^\]]+\]\s*)*(\w{3,32}) has invited you to join their party!/i,
  /^You have been invited to join (?:\[[^\]]+\]\s*)*(\w{3,32})'s party!/i
]

export const PartyJoinRegex = [
  /^Party created!/i,
  /^You are now in a party with /i,
  /^You (?:have )?joined (?:\[[^\]]+\]\s*)*\w{3,32}'s party!?/i,
  /^(?:\[[^\]]+\]\s*)*\w{3,32} joined the party\./i
]

export const PartyMemberJoinedRegex = [/^(?:\[[^\]]+\]\s*)*(\w{3,32}) joined the party!?/i]

export function findPartyMemberJoined(message: string): string | undefined {
  const clean = message.replaceAll(/§./g, '').trim()
  for (const line of clean.split('\n')) {
    for (const regex of PartyMemberJoinedRegex) {
      const match = regex.exec(line.trim())
      if (match != undefined) return match[1]
    }
  }
  return undefined
}

export const PartyLeaveRegex = [
  /^You left the party\./i,
  /^The party was disbanded\./i,
  /^You have been kicked from the party\./i
]

export function findPartyInvite(message: string): string | undefined {
  const clean = message.replaceAll(/§./g, '').trim()
  for (const line of clean.split('\n')) {
    for (const regex of PartyInviteRegex) {
      const match = regex.exec(line.trim())
      if (match != undefined) return match[1]
    }
  }
  return undefined
}

function matchesAny(message: string, regexes: RegExp[]): boolean {
  const clean = message.replaceAll(/§./g, '').trim()
  return clean.split('\n').some((line) => regexes.some((regex) => regex.test(line.trim())))
}

export function updatePartyState(message: string, current: boolean): boolean {
  if (matchesAny(message, PartyJoinRegex)) return true
  if (matchesAny(message, PartyLeaveRegex)) return false
  return current
}
