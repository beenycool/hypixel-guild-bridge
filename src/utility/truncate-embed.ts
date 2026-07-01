import type { APIEmbed } from 'discord.js'

export function truncateEmbed(embed: APIEmbed): APIEmbed {
  return {
    ...embed,
    title: embed.title?.slice(0, 256),
    description: embed.description?.slice(0, 4096),
    author: embed.author ? { ...embed.author, name: embed.author.name.slice(0, 256) } : undefined,
    footer: embed.footer ? { ...embed.footer, text: embed.footer.text.slice(0, 2048) } : undefined,
    fields: embed.fields?.slice(0, 25).map((f) => ({
      ...f,
      name: f.name.slice(0, 256),
      value: f.value.slice(0, 1024)
    }))
  }
}
