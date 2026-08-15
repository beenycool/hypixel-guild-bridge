import { createCanvas, loadImage } from 'canvas'

import { httpClient } from '../../../common/http.js'
import type { MinecraftConfigurations } from '../../../core/minecraft/minecraft-configurations'
import { stufEncode } from '../common/url-encoder.js'

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

interface HttpClient {
  head: typeof httpClient.head
  post: typeof httpClient.post
  get: typeof httpClient.get
}

interface SanitizerOptions {
  maxDescriptionLength?: number
}

const DEFAULT_DESCRIPTION_LENGTH = 80
const MAX_GIF_BYTES = 8 * 1024 * 1024

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
        } catch {}
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
              return await this.describeMedia(part, type, contentType, maxDescriptionLength)
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

  private async describeMedia(
    url: string,
    type: 'image' | 'video',
    contentType: string,
    maxDescriptionLength?: number
  ): Promise<string> {
    if (!this.openrouterApiKey) return `(${type})`

    const maxLength = maxDescriptionLength ?? DEFAULT_DESCRIPTION_LENGTH

    try {
      let mediaUrl = url
      if (type === 'image' && contentType.toLowerCase().includes('gif')) {
        const converted = await this.gifToPngDataUrl(url)
        if (converted === undefined) return '(image)'
        mediaUrl = converted
      }

      /* eslint-disable @typescript-eslint/naming-convention -- OpenAI content-block wire format */
      const contentBlock =
        type === 'video'
          ? { type: 'video_url', video_url: { url: mediaUrl } }
          : { type: 'image_url', image_url: { url: mediaUrl } }
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

  private async gifToPngDataUrl(url: string): Promise<string | undefined> {
    try {
      const response = await this.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 10_000 })
      const buffer = Buffer.from(response.data)
      if (buffer.length === 0 || buffer.length > MAX_GIF_BYTES) return undefined

      const image = await loadImage(buffer)
      const canvas = createCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)

      return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
    } catch {
      return undefined
    }
  }
}
