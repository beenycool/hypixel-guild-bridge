import { httpClient } from '../../../common/http.js'
import type { MinecraftConfigurations } from '../../../core/minecraft/minecraft-configurations'
import { stufEncode } from '../common/url-encoder.js'

export class LinksSanitizer {
  constructor(
    private readonly config: MinecraftConfigurations,
    private readonly openrouterApiKey: string | undefined
  ) {}

  public async process(message: string): Promise<string> {
    if (this.config.getHideLinksViaStuf()) {
      message = stufEncode(message)
    } else if (this.config.getResolveHideLinks()) {
      message = await this.resolveLinkHide(message)
    } else {
      message = this.hideLink(message)
    }

    return message
  }

  private hideLink(message: string): string {
    return message
      .split(' ')
      .map((part) => {
        try {
          if (part.startsWith('https:') || part.startsWith('http')) return '(link)'
        } catch {
          /* ignored */
        }
        return part
      })
      .join(' ')
  }

  private async resolveLinkHide(message: string): Promise<string> {
    const parts = message.split(' ')
    const indexes: number[] = []
    const promises: Promise<string>[] = []

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      if (!part.startsWith('https:') && !part.startsWith('http')) {
        parts[index] = part
        continue
      }

      indexes.push(index)
      promises.push(
        httpClient
          .head(part, { timeout: 5000 })
          .then(async (response) => {
            const contentType = response.headers['content-type'] as undefined as string | undefined
            if (typeof contentType !== 'string') return '(link)'

            const type = contentType.split('/')[0]
            if (type === 'image' || type === 'video') {
              return await this.describeMedia(part, type)
            } else if (contentType.includes('application/pdf')) {
              return '(pdf)'
            }
            return '(link)'
          })
          .catch(() => '(link)')
      )
    }

    const results = await Promise.all(promises)
    for (const [index_, index] of indexes.entries()) {
      parts[index] = results[index_]
    }

    return parts.join(' ')
  }

  private async describeMedia(url: string, type: 'image' | 'video'): Promise<string> {
    if (!this.openrouterApiKey) return `(${type})`

    try {
      const contentBlock =
        type === 'video' ? { type: 'video_url', video_url: { url } } : { type: 'image_url', image_url: { url } }

      const response = await httpClient.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: `Describe this ${type} concisely in under 80 characters.` }, contentBlock]
            }
          ],
          max_tokens: 100,
          temperature: 0.3,
          reasoning: { effort: 'none' }
        },
        {
          headers: {
            Authorization: `Bearer ${this.openrouterApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30_000
        }
      )

      const content: unknown = response.data?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.length === 0) return `(${type})`

      const maxLength = 80
      if (content.length <= maxLength) return content

      const breakIndex = content.lastIndexOf(' ', maxLength - 3)
      const truncateAt = breakIndex > 0 ? breakIndex : maxLength - 3
      return `${content.slice(0, truncateAt)}...`
    } catch {
      return `(${type})`
    }
  }
}
