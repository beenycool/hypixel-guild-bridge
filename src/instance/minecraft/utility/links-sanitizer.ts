import { httpClient } from '../../../common/http.js'
import type { MinecraftConfigurations } from '../../../core/minecraft/minecraft-configurations'
import { stufEncode } from '../common/url-encoder.js'

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

interface HttpClient {
  head: typeof httpClient.head
  post: typeof httpClient.post
}

interface SanitizerOptions {
  maxDescriptionLength?: number
}

const DEFAULT_DESCRIPTION_LENGTH = 80

export class LinksSanitizer {
  private readonly http: HttpClient

  constructor(
    private readonly config: MinecraftConfigurations,
    private readonly openrouterApiKey: string | undefined,
    http: HttpClient = httpClient
  ) {
    this.http = http
  }

  public async process(message: string, options?: SanitizerOptions): Promise<string> {
    if (this.config.getHideLinksViaStuf()) {
      message = stufEncode(message)
    } else if (this.config.getResolveHideLinks()) {
      message = await this.resolveLinkHide(message, options?.maxDescriptionLength)
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

  private async resolveLinkHide(message: string, maxDescriptionLength?: number): Promise<string> {
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
        this.http
          .head(part, { timeout: 5000 })
          .then(async (response) => {
            const contentType = response.headers['content-type'] as undefined as string | undefined
            if (typeof contentType !== 'string') return '(link)'

            const type = contentType.split('/')[0]
            if (type === 'image' || type === 'video') {
              return await this.describeMedia(part, type, maxDescriptionLength)
            } else if (contentType.includes('application/pdf')) {
              return '(pdf)'
            }
            return '(link)'
          })
          .catch(() => '(link)')
      )
    }

    const results = await Promise.all(promises)
    for (const [resultIndex, index] of indexes.entries()) {
      parts[index] = results[resultIndex]
    }

    return parts.join(' ')
  }

  private async describeMedia(url: string, type: 'image' | 'video', maxDescriptionLength?: number): Promise<string> {
    if (!this.openrouterApiKey) return `(${type})`

    const maxLength = maxDescriptionLength ?? DEFAULT_DESCRIPTION_LENGTH

    try {
      /* eslint-disable @typescript-eslint/naming-convention -- OpenAI content-block wire format */
      const contentBlock =
        type === 'video' ? { type: 'video_url', video_url: { url } } : { type: 'image_url', image_url: { url } }
      /* eslint-enable @typescript-eslint/naming-convention */

      const response = await this.http.post<ChatCompletionResponse>(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          /* eslint-disable @typescript-eslint/naming-convention -- OpenRouter API request body wire format */
          model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `Describe this ${type} concisely in under ${maxLength} characters.` },
                contentBlock
              ]
            }
          ],
          max_tokens: 256,
          temperature: 0.3,
          reasoning: { effort: 'none' }
          /* eslint-enable @typescript-eslint/naming-convention */
        },
        {
          /* eslint-disable @typescript-eslint/naming-convention -- HTTP header names required by the protocol */
          headers: {
            Authorization: `Bearer ${this.openrouterApiKey}`,
            'Content-Type': 'application/json'
          },
          /* eslint-enable @typescript-eslint/naming-convention */
          timeout: 30_000
        }
      )

      const content: unknown = response.data.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.length === 0) return `(${type})`

      const description = this.truncate(content.trim(), maxLength)
      return `sent a${type === 'image' ? 'n' : ''} ${type}: ${description}`
    } catch {
      return `(${type})`
    }
  }

  private truncate(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content

    const breakIndex = content.lastIndexOf(' ', maxLength - 3)
    const truncateAt = breakIndex > 0 ? breakIndex : maxLength - 3
    return `${content.slice(0, truncateAt)}...`
  }
}
