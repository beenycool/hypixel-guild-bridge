import axios from 'axios'

export interface ChatCompletionOptions {
  model?: string
  systemPrompt: string
  userPrompt: string
  temperature?: number
  reasoningEffort?: string
}

export interface ChatCompletionResult {
  content: string
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

    const response = await axios.post(this.baseUrl, body, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: this.timeoutMs
    })

    const content: unknown = response.data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenRouter returned empty or invalid response content')
    }

    return { content }
  }
}

export { isAxiosError } from 'axios'
