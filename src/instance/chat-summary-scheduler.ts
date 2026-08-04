import axios from 'axios'
import type { TextChannel } from 'discord.js'

import type Application from '../application.js'
import { InstanceType } from '../common/application-event.js'
import { Instance } from '../common/instance.js'
import Duration from '../utility/duration.js'
import { setIntervalAsync } from '../utility/scheduling.js'

/* eslint-disable @typescript-eslint/naming-convention -- interface mirrors OpenRouter/OpenAI API wire format */
interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
  }
}
/* eslint-enable @typescript-eslint/naming-convention */

export class ChatSummaryScheduler extends Instance<InstanceType.Utility> {
  private started = false
  private intervalHandle: NodeJS.Timeout | undefined
  private lastTriggeredDay = -1
  private needsRetry = false
  private lastRetryTimestamp = 0
  private readonly retryIntervalMs = Duration.minutes(15).toMilliseconds()

  constructor(application: Application) {
    super(application, 'chat-summary-scheduler', InstanceType.Utility)
  }

  public start(): void {
    if (this.started) return
    this.started = true

    this.intervalHandle = setIntervalAsync(
      async () => {
        try {
          await this.checkAndTrigger()
        } catch (error: unknown) {
          this.logger.warn('Chat summary scheduler check failed', error)
        }
      },
      { errorHandler: this.errorHandler.promiseCatch('chat summary scheduler'), delay: Duration.minutes(1) }
    )

    this.application.addShutdownListener(() => {
      this.stop()
    })
  }

  public stop(): void {
    if (!this.started) return
    this.started = false
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
  }

  private getUkParts(): { hour: number; minute: number; day: number } {
    const now = new Date()
    const parts = Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: 'numeric',
      day: 'numeric'
    }).formatToParts(now)
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? Number.NaN)
    return { hour: get('hour'), minute: get('minute'), day: get('day') }
  }

  private async checkAndTrigger(): Promise<void> {
    const apiKey = process.env.HACKCLUB_API_KEY ?? this.application.openrouterApiKey
    if (!apiKey) {
      return
    }

    const { day } = this.getUkParts()
    const now = Date.now()

    // First run after restart — sync day without triggering
    if (this.lastTriggeredDay === -1) {
      this.lastTriggeredDay = day
      return
    }

    // If already triggered for today, only retry if needed
    if (this.lastTriggeredDay === day) {
      if (this.needsRetry && now - this.lastRetryTimestamp >= this.retryIntervalMs) {
        this.logger.info('Retrying chat summary generation...')
        try {
          await this.generateAndPostSummaries()
          this.needsRetry = false
          this.logger.info('Chat summary generation succeeded on retry')
        } catch (error: unknown) {
          this.lastRetryTimestamp = now
          this.logger.error('Chat summary generation retry failed, will retry again in 15m:', error)
        }
      }
      return
    }

    // Day changed — trigger generation (catches up if midnight was missed)
    this.logger.info('Triggering daily chat summary generation...')
    try {
      await this.generateAndPostSummaries()
      this.lastTriggeredDay = day
      this.needsRetry = false
      this.logger.info('Chat summary generation succeeded')
    } catch (error: unknown) {
      this.logger.error('Chat summary generation failed, will retry in 15m:', error)
      this.needsRetry = true
      this.lastRetryTimestamp = now
    }
  }

  public async generateAndPostSummaries(additionalChannelId?: string): Promise<void> {
    const bridgeConfigurations = this.application.core.bridgeConfigurations
    const bridgeIds = bridgeConfigurations.getAllBridgeIds()

    const nowSeconds = Math.floor(Date.now() / 1000)
    const startTime = nowSeconds - 24 * 60 * 60

    for (const bridgeId of bridgeIds) {
      try {
        if (!bridgeConfigurations.getChatSummaryEnabled(bridgeId)) {
          continue
        }

        const channelIds = bridgeConfigurations.getChatSummaryChannelIds(bridgeId)
        if (channelIds.length === 0 && !additionalChannelId) {
          this.logger.warn(`Chat summary is enabled for bridge ${bridgeId} but no summary channels are configured.`)
          continue
        }

        const targetChannelIds =
          additionalChannelId && !channelIds.includes(additionalChannelId)
            ? [...channelIds, additionalChannelId]
            : channelIds

        // Fetch messages for this bridge in the last 24 hours
        const rows = await this.application.core.databaseManager.queryRows<{
          userId: string
          username: string | null
          discordId: string | null
          message: string
          createdAt: number
        }>(
          `SELECT "userId", "username", "discordId", "message", "createdAt"
           FROM "ChatMessages"
           WHERE "bridgeId" = $1 AND "createdAt" >= $2
           ORDER BY "createdAt" ASC`,
          [bridgeId, startTime]
        )

        if (rows.length === 0) {
          this.logger.info(`No chat activity to summarize for bridge ${bridgeId} today.`)
          continue
        }

        this.logger.info(`Found ${rows.length} messages to summarize for bridge ${bridgeId}.`)

        // Format logs for AI
        const logsText = rows
          .map((r) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DB rows may contain NULL for username
            const username = r.username ?? r.userId ?? 'Unknown'
            const mentionInfo = r.discordId ? ` (Discord: <@${r.discordId}>)` : ''
            return `${username}${mentionInfo}: ${r.message}`
          })
          .join('\n')

        const apiKey = process.env.HACKCLUB_API_KEY ?? this.application.openrouterApiKey
        if (!apiKey) continue

        const model = 'anthropic/claude-sonnet-5'

        const systemPrompt = `You are the ultimate, hyper-dramatic "Gossip Girl" of a chaotic Minecraft Discord server. Your job is to read today's raw chat logs and write a highly entertaining, juicy, cohesive narrative summary of the drama.

STRICT GUIDELINES:

Narrative Flow: Write a continuous gossip column. Do NOT give a timeline or bullet points. Connect topics via natural, cause-and-effect transitions (e.g., A-plot, B-plot, C-plot).

Tone: Exaggerated, drama-obsessed, and slightly sassy. Speculate wildly on the users' motivations. Use phrases like "swoops in like a super-villain," "so intense," etc.

Format: Write in 3-4 long, flowing paragraphs.

Authenticity: Preserve specific emoticons (like ( ﾟ◡ﾟ)/), inside jokes, and exact slang. Do not sanitize the culture.

Slang: Use lots of internet/gen-z slang like "fr", "no cap", "based", "cooked", "ate", "bet", "W", "L", "brainrot", "skibidi", "gyatt" etc. Make it feel like a group chat recap.

Quotes & Drama: Focus heavily on conflicts, pile-ons, and smug moments. Weave direct, short quotes naturally into your sentences.

ZERO CENSORSHIP (CRITICAL): Do not censor ANY language from the logs. You MUST quote crude words exactly as written. No asterisks (*), no redactions. Reframe crude moments as part of the story.

Emojis: Use lots of emojis. Sprinkle them everywhere — every paragraph should have 3-5+ emojis. Drama, laughing, fire, skull, clown, pray, etc.

Length Requirement: HARD LIMIT — your final output MUST be between 1,900 and 2,000 characters. Count your characters before outputting. Shorter sentences, tighter phrasing. Do not exceed 2,000.

Output: No meta-commentary, no greetings. Output ONLY the final summary.`

        const userContent = `Here are the chat logs from today:\n\n${logsText}`

        this.logger.info(`Sending request to OpenRouter using model: ${model}`)
        const response = await axios.post<ChatCompletionResponse>(
          'https://ai.hackclub.com/proxy/v1/chat/completions',
          {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent }
            ],
            temperature: 0.7,
            reasoning: { effort: 'high' }
          },
          {
            /* eslint-disable @typescript-eslint/naming-convention -- HTTP header names required by the protocol */
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            /* eslint-enable @typescript-eslint/naming-convention */
            timeout: 60_000
          }
        )

        const summaryText = response.data.choices?.[0]?.message?.content
        if (typeof summaryText !== 'string' || summaryText.length === 0) {
          throw new Error('Invalid OpenRouter response: empty summary')
        }

        const client = this.application.discordInstance.getClient()
        const chunks = this.splitMessage(summaryText)

        for (const channelId of targetChannelIds) {
          const channel = await client.channels.fetch(channelId).catch(() => undefined)
          if (channel && channel.isTextBased() && !channel.isDMBased()) {
            for (const chunk of chunks) {
              await (channel as TextChannel).send({ content: chunk })
            }
            this.logger.info(`Successfully posted chat summary to channel ${channelId}`)
            const usage = response.data.usage
            if (usage) {
              const footer = `-# Input: ${usage.prompt_tokens ?? '?'} · Output: ${usage.completion_tokens ?? '?'} · Cost: $${(usage.cost ?? 0).toFixed(6)} · Model: ${model}`
              await (channel as TextChannel).send({ content: footer })
            }
          } else {
            this.logger.warn(`Channel ${channelId} not found or is not a valid text channel.`)
          }
        }
      } catch (error: unknown) {
        this.logger.error(`Failed to generate/post chat summary for bridge ${bridgeId}:`, error)
      }
    }
  }

  private splitMessage(text: string, maxLength = 2000): string[] {
    if (text.length <= maxLength) return [text]
    const chunks: string[] = []
    let currentChunk = ''

    const paragraphs = text.split('\n')
    for (const paragraph of paragraphs) {
      if ((currentChunk + '\n' + paragraph).length > maxLength) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk)
        }
        currentChunk = paragraph
      } else {
        currentChunk = currentChunk ? currentChunk + '\n' + paragraph : paragraph
      }
    }
    if (currentChunk.trim()) {
      chunks.push(currentChunk)
    }
    return chunks
  }
}
