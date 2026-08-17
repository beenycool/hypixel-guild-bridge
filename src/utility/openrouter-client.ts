import axios, { isAxiosError } from 'axios'
import type { Logger } from 'log4js'

interface ChatCompletionOptions {
  model?: string
  systemPrompt: string
  userPrompt: string
  temperature?: number
  reasoningEffort?: string
}

interface ChatCompletionResult {
  content: string
}

interface OpenRouterResponse {
  choices?: {
    message?: {
      content?: string
    }
  }[]
}

export class OpenRouterClient {
  private readonly apiKey: string
  private readonly defaultModel: string | undefined
  private readonly timeoutMs: number
  private readonly baseUrl: string

  constructor(apiKey: string, options?: { defaultModel?: string; timeoutMs?: number; baseUrl?: string }) {
    this.apiKey = apiKey
    this.defaultModel = options?.defaultModel
    this.timeoutMs = options?.timeoutMs ?? 30_000
    this.baseUrl = options?.baseUrl ?? 'https://openrouter.ai/api/v1/chat/completions'
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const model = options.model ?? this.defaultModel
    if (model === undefined) {
      throw new Error('No model specified and no default model configured')
    }

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt }
      ],
      temperature: options.temperature ?? 0
    }

    if (options.reasoningEffort !== undefined) {
      body.reasoning = { effort: options.reasoningEffort }
    }

    const response = await axios.post<OpenRouterResponse>(this.baseUrl, body, {
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the protocol
        Authorization: `Bearer ${this.apiKey}`,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the protocol
        'Content-Type': 'application/json'
      },
      timeout: this.timeoutMs
    })

    const content: unknown = response.data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenRouter returned empty or invalid response content')
    }

    return { content }
  }
}

export function formatOpenRouterError(error: unknown, featureName: string, logger?: Logger): string {
  if (isAxiosError(error)) {
    logger?.error(
      `${featureName} API error: status=${error.response?.status.toString() ?? 'unknown'}, ` +
        `message=${error.message}` +
        (error.response?.data ? `, data=${JSON.stringify(error.response.data)}` : '')
    )

    if (error.response?.status === 401) {
      return `${featureName} failed: Invalid API key`
    }

    if (error.response?.status === 402) {
      return `${featureName} failed: Insufficient credits`
    }

    if (error.response?.status === 429) {
      return `${featureName} failed: Rate limited. Please try again later.`
    }

    if (error.code === 'ECONNABORTED') {
      return `${featureName} failed: Request timed out. Please try again.`
    }

    const apiMessage: unknown = (error.response?.data as { error?: { message?: unknown } } | undefined)?.error?.message
    const fallback = typeof apiMessage === 'string' ? apiMessage : error.message
    return `${featureName} failed: ${fallback}`
  }

  logger?.error(error)
  return `${featureName} failed: An unexpected error occurred`
}

export { isAxiosError } from 'axios'
