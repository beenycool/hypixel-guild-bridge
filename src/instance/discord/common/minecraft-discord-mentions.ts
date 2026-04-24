import type { Guild } from 'discord.js'
import { escapeMarkdown } from 'discord.js'

const MentionTokenRegex = /\B@([^\s@]{1,32})/g
const DisallowedMentions = new Set(['everyone', 'here'])
/** Cap REST `guild.members.search` calls per message to reduce rate-limit risk. */
const MaxMemberSearchTokens = 5

export interface ResolvedDiscordMentions {
  content: string
  userIds: string[]
}

export async function resolveDiscordMentionsInMessage(message: string, guild: Guild): Promise<ResolvedDiscordMentions> {
  const uniqueTokens = new Map<string, string>()
  for (const match of message.matchAll(MentionTokenRegex)) {
    const token = match[1]

    const lowered = token.toLowerCase()
    if (DisallowedMentions.has(lowered)) continue

    if (!uniqueTokens.has(lowered)) uniqueTokens.set(lowered, token)
  }

  const tokenToUserId = new Map<string, string>()
  const searchEntries = [...uniqueTokens.entries()].slice(0, MaxMemberSearchTokens)
  for (const [lowered, token] of searchEntries) {
    const results = await guild.members.search({ query: token, limit: 25 })
    const members = [...results.values()]

    const usernameMatches = members.filter((member) => member.user.username.toLowerCase() === lowered)
    if (usernameMatches.length === 1) {
      tokenToUserId.set(lowered, usernameMatches[0].id)
      continue
    }
    if (usernameMatches.length > 1) continue

    const nicknameMatches = members.filter((member) => member.nickname?.toLowerCase() === lowered)
    if (nicknameMatches.length === 1) {
      tokenToUserId.set(lowered, nicknameMatches[0].id)
    }
  }

  let content = ''
  let cursor = 0
  for (const match of message.matchAll(MentionTokenRegex)) {
    const token = match[1]
    const start = match.index
    const mention = match[0]
    const end = start + mention.length
    content += escapeMarkdown(message.slice(cursor, start))

    const userId = tokenToUserId.get(token.toLowerCase())
    content += userId === undefined ? escapeMarkdown(mention) : `<@${userId}>`
    cursor = end
  }
  content += escapeMarkdown(message.slice(cursor))

  return { content, userIds: [...new Set(tokenToUserId.values())] }
}
