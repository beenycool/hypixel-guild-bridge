import type { Guild, GuildMember } from 'discord.js'
import { escapeMarkdown } from 'discord.js'

const MentionTokenRegex = /\B@([^\s@]{1,32})/g
const DisallowedMentions = new Set(['everyone', 'here'])
/** Cap REST `guild.members.search` calls per message to reduce rate-limit risk. */
const MaxMemberSearchTokens = 5

const ResolvedMentionsCache = new Map<string, { userId: string; timestamp: number }>()
const CacheTTL = 60 * 60 * 1000 // 1 hour

const MinecraftNameCache = new Map<string, { userId: string; timestamp: number }>()
const MinecraftNameCacheTTL = 60 * 60 * 1000 // 1 hour

export interface ResolvedDiscordMentions {
  content: string
  userIds: string[]
}

export async function resolveDiscordMentionsInMessage(
  message: string,
  guild: Guild,
  resolveMinecraftName?: (username: string) => Promise<string | undefined>
): Promise<ResolvedDiscordMentions> {
  const uniqueTokens = new Map<string, string>()
  for (const match of message.matchAll(MentionTokenRegex)) {
    const token = match[1]

    const lowered = token.toLowerCase()
    if (DisallowedMentions.has(lowered)) continue

    if (!uniqueTokens.has(lowered)) uniqueTokens.set(lowered, token)
  }

  const tokenToUserId = new Map<string, string>()
  const searchEntries = [...uniqueTokens.entries()].slice(0, MaxMemberSearchTokens)

  const unrestoredEntries: [string, string][] = []
  for (const [lowered, token] of searchEntries) {
    const cached = ResolvedMentionsCache.get(lowered)
    if (cached && Date.now() - cached.timestamp < CacheTTL) {
      tokenToUserId.set(lowered, cached.userId)
    } else {
      unrestoredEntries.push([lowered, token])
    }
  }

  const searchResults: { lowered: string; members: GuildMember[] }[] = []
  for (const [lowered, token] of unrestoredEntries) {
    const results = await guild.members.search({ query: token, limit: 25 })
    searchResults.push({ lowered, members: [...results.values()] })
  }

  for (const { lowered, members } of searchResults) {
    const usernameMatches = members.filter((member) => member.user.username.toLowerCase() === lowered)
    if (usernameMatches.length === 1) {
      const userId = usernameMatches[0].id
      tokenToUserId.set(lowered, userId)
      ResolvedMentionsCache.set(lowered, { userId, timestamp: Date.now() })
      continue
    }
    if (usernameMatches.length > 1) continue

    const nicknameMatches = members.filter((member) => member.nickname?.toLowerCase() === lowered)
    if (nicknameMatches.length === 1) {
      const userId = nicknameMatches[0].id
      tokenToUserId.set(lowered, userId)
      ResolvedMentionsCache.set(lowered, { userId, timestamp: Date.now() })
    }
  }

  // Fallback: try resolving unmatched tokens as Minecraft usernames
  if (resolveMinecraftName !== undefined) {
    for (const [lowered, token] of searchEntries) {
      if (tokenToUserId.has(lowered)) continue

      const cached = MinecraftNameCache.get(lowered)
      if (cached !== undefined && Date.now() - cached.timestamp < MinecraftNameCacheTTL) {
        tokenToUserId.set(lowered, cached.userId)
      } else {
        const discordId = await resolveMinecraftName(token)
        if (discordId !== undefined) {
          tokenToUserId.set(lowered, discordId)
          MinecraftNameCache.set(lowered, { userId: discordId, timestamp: Date.now() })
        }
      }
    }
  }

  // Clean old cache entries occasionally
  if (ResolvedMentionsCache.size > 500) {
    const now = Date.now()
    for (const [key, value] of ResolvedMentionsCache.entries()) {
      if (now - value.timestamp > CacheTTL) ResolvedMentionsCache.delete(key)
    }
  }

  if (MinecraftNameCache.size > 500) {
    const now = Date.now()
    for (const [key, value] of MinecraftNameCache.entries()) {
      if (now - value.timestamp > MinecraftNameCacheTTL) MinecraftNameCache.delete(key)
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
