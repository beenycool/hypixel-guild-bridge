import DefaultAxios from 'axios'

import type { MinecraftConfigurations } from '../../../core/minecraft/minecraft-configurations'
import { stufEncode } from '../common/stuf.js'

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
    const newMessage: string[] = []

    for (const part of message.split(' ')) {
      if (!part.startsWith('https:') && !part.startsWith('http')) {
        newMessage.push(part)
        continue
      }

      const response = await DefaultAxios.head(part).catch(() => undefined)
      if (response === undefined) {
        newMessage.push('(link)')
        continue
      }

      const contentType = response.headers['content-type'] as undefined as string | undefined
      if (typeof contentType !== 'string') {
        newMessage.push('(link)')
        continue
      }

      const type = contentType.split('/')[0]
      if (type === 'image') {
        const description = await this.describeImage(part)
        newMessage.push(description)
      } else if (type === 'video') newMessage.push('(video)')
      else if (contentType.includes('application/pdf')) newMessage.push('(pdf)')
      else newMessage.push('(link)')
    }

    return newMessage.join(' ')
  }

  private async describeImage(imageUrl: string): Promise<string> {
    if (!this.openrouterApiKey) return '(image)'

    try {
      const response = await DefaultAxios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this image concisely in under 80 characters.' },
                { type: 'image_url', image_url: { url: imageUrl } }
              ]
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
      if (typeof content !== 'string' || content.length === 0) return '(image)'

      const maxLen = 80
      if (content.length <= maxLen) return content

      const breakIndex = content.lastIndexOf(' ', maxLen - 3)
      const truncateAt = breakIndex > 0 ? breakIndex : maxLen - 3
      return `${content.slice(0, truncateAt)}...`
    } catch {
      return '(image)'
    }
  }
}
