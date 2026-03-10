import type { APIEmbed } from 'discord.js'

// Discord's actual embed description limit is 4096 characters
// We use 4000 to be safe and account for potential formatting overhead
const DefaultMaxLength = 4000

/**
 * Split a long text into multiple embed pages based on max length.
 * Tries to split at line breaks; if a single line is longer than maxLen, it will be chunked.
 * Ensures that each embed description does not exceed Discord's 4096 character limit.
 */
export function splitToEmbeds(base: APIEmbed, text: string, maxLength = DefaultMaxLength): APIEmbed[] {
  const pages: APIEmbed[] = []
  const lines = text.split('\n')

  let current = { ...base, description: '' } as APIEmbed
  let currentLength = 0

  for (const line of lines) {
    const lineWithNewline = line + '\n'

    if (lineWithNewline.length > maxLength) {
      // Chunk very long single lines
      let offset = 0
      while (offset < lineWithNewline.length) {
        const chunk = lineWithNewline.slice(offset, offset + maxLength)
        if (currentLength + chunk.length > maxLength) {
          pages.push(current)
          current = { ...base, description: '' } as APIEmbed
          currentLength = 0
        }
        current.description += chunk
        currentLength += chunk.length
        offset += chunk.length
      }
      continue
    }

    if (currentLength + lineWithNewline.length > maxLength) {
      // start a new page
      pages.push(current)
      current = { ...base, description: '' } as APIEmbed
      currentLength = 0
    }

    current.description += lineWithNewline
    currentLength += lineWithNewline.length
  }

  // push last page
  if ((current.description ?? '').length > 0) pages.push(current)

  // Final validation: ensure no embed description exceeds Discord's 4096 character limit
  const discordMaxLength = 4096
  return pages.map((page) => {
    const description = page.description ?? ''
    if (description.length > discordMaxLength) {
      // If description still exceeds limit, truncate it safely
      const truncatedDescription = description.slice(0, Math.max(0, discordMaxLength - 3)) + '...'
      return { ...page, description: truncatedDescription }
    }
    return page
  })
}
