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

// openrouter wrapper - nothing fancy, just post to their endpoint
export class OpenRouterClient {
  private readonly key: string
  private readonly defaultModel?: string
  private readonly timeout: number
  private readonly endpoint: string

  constructor(apiKey: string, options?: { defaultModel?: string; timeoutMs?: number; baseUrl?: string }) {
    this.key = apiKey
    this.defaultModel = options?.defaultModel
    this.timeout = options?.timeoutMs ?? 30_000
    this.endpoint = options?.baseUrl ?? 'https://openrouter.ai/api/v1/chat/completions'
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const model = options.model ?? this.defaultModel
    if (!model) {
      throw new Error('No model provided and no fallback model configured in config')
    }

    const payload: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt }
      ],
      temperature: options.temperature ?? 0
    }

    if (options.reasoningEffort) {
      payload.reasoning = { effort: options.reasoningEffort }
    }

    const response = await axios.post<OpenRouterResponse>(this.endpoint, payload, {
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Authorization: `Bearer ${this.key}`,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json'
      },
      timeout: this.timeout
    })

    const txt = response.data.choices?.[0]?.message?.content
    if (!txt) {
      throw new Error('OpenRouter returned empty response??')
    }

    return { content: txt }
  }
}

export function formatOpenRouterError(error: unknown, featureName: string, logger?: Logger): string {
  if (isAxiosError(error)) {
    logger?.error(`[${featureName}] OpenRouter error:`, error.message)
    const code = error.response?.status
    if (code === 401) return `${featureName} failed: Bad API key (check your openrouter key)`
    if (code === 402) return `${featureName} failed: Out of credits lol`
    const data = error.response?.data as { error?: { message?: string } } | undefined
    const message = data?.error?.message ?? error.message
    return `${featureName} failed: ${message}`
  }

  logger?.error(`[${featureName}] Unexpected failure:`, error)
  return `${featureName} failed: Something went wrong`
}

export { isAxiosError } from 'axios'
