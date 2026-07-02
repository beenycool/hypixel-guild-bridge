import type { TextChannel } from 'discord.js'
import axios from 'axios'
import type Application from '../application.js'
import { InstanceType } from '../common/application-event.js'
import { Instance } from '../common/instance.js'
import Duration from '../utility/duration.js'
import { setIntervalAsync } from '../utility/scheduling.js'

export class ChatSummaryScheduler extends Instance<InstanceType.Utility> {
  private started = false
  private intervalHandle: NodeJS.Timeout | undefined
  private lastTriggeredDay = -1

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
    const apiKey = this.application.openrouterApiKey
    if (!apiKey) {
      return
    }

    const { hour, minute, day } = this.getUkParts()

    // Trigger at midnight (00:00) Europe/London time
    if (hour !== 0 || minute !== 0) return

    if (this.lastTriggeredDay === day) return
    this.lastTriggeredDay = day

    this.logger.info('Triggering daily chat summary generation...')
    await this.generateAndPostSummaries()
  }

  public async generateAndPostSummaries(): Promise<void> {
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
        if (channelIds.length === 0) {
          this.logger.warn(`Chat summary is enabled for bridge ${bridgeId} but no summary channels are configured.`)
          continue
        }

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
            const username = r.username ?? r.userId ?? 'Unknown'
            const mentionInfo = r.discordId ? ` (Discord: <@${r.discordId}>)` : ''
            return `${username}${mentionInfo}: ${r.message}`
          })
          .join('\n')

        // Determine chattiest user
        const counts: Record<string, { count: number; discordId: string | null; username: string }> = {}
        for (const row of rows) {
          const username = row.username ?? row.userId ?? 'Unknown'
          const authorKey = row.discordId ?? username
          if (!counts[authorKey]) {
            counts[authorKey] = { count: 0, discordId: row.discordId, username }
          }
          counts[authorKey].count++
        }

        let chattiest: { count: number; discordId: string | null; username: string } | null = null
        for (const key in counts) {
          if (!chattiest || counts[key].count > chattiest.count) {
            chattiest = counts[key]
          }
        }

        const apiKey = this.application.openrouterApiKey
        if (!apiKey) continue

        const model = this.application.openrouterModel ?? 'nvidia/nemotron-3-ultra-550b-a55b:free'

        const systemPrompt = `You are a gossipy, high-energy, exclamation-heavy, emoji-rich server chat commentator. 
Your job is to read the guild chat logs from a Minecraft server and write a highly dramatic, entertaining, and gossipy summary of the events, conversations, and conflicts that happened today.

Style guidelines:
1. Start your message with the exact title: "Server Talk 💬" (followed by a newline).
2. The tone must be extremely dramatic, gossip-focused, and slightly sassy, similar to a high school drama commentator. Use phrases like "SO super dramatic!", "OMG!", "so uncool!", "exploded!", "pure fury", "sassy", "smug", "super firm".
3. Use emojis throughout the text to make it lively and fun.
4. Keep the summary engaging, detailed, but concise, ensuring the total character count is under 1800 characters to fit in a single message.
5. Refer to players by their plain usernames (e.g. "nismomeow", "adrianriley1994", "frostycookies") when describing their interactions.
6. In a separate sentence (e.g., after the first paragraph or topic), include a line in this exact format: "<@discordId> was today's chattiest with X messages! 🏆" (substituting the correct Discord mention like "<@123456789>" if a Discord ID is available, otherwise using their plain username, and the correct message count).
7. Do not censor words or drama from the logs, but present them in a fun, story-like way.`

        const userContent = `Here are the chat logs from today:\n\n${logsText}\n\nImportant instructions:\n- Today's chattiest user is: ${chattiest ? (chattiest.discordId ? `<@${chattiest.discordId}>` : chattiest.username) : 'None'} with ${chattiest ? chattiest.count : 0} messages.\n- You MUST include a sentence in the exact format: '<@discordId> was today's chattiest with X messages! :first_place:' (using their Discord mention if available, otherwise their username).`

        this.logger.info(`Sending request to OpenRouter using model: ${model}`)
        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent }
            ],
            temperature: 0.7,
            ...(model.includes('nemotron') ? { reasoning: { effort: 'high' } } : {})
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 60_000
          }
        )

        const summaryText = response.data?.choices?.[0]?.message?.content
        if (typeof summaryText !== 'string' || summaryText.length === 0) {
          throw new Error('Invalid OpenRouter response: empty summary')
        }

        const client = this.application.discordInstance.getClient()
        const chunks = this.splitMessage(summaryText)

        for (const channelId of channelIds) {
          const channel = await client.channels.fetch(channelId).catch(() => undefined)
          if (channel && channel.isTextBased() && !channel.isDMBased()) {
            for (const chunk of chunks) {
              await (channel as TextChannel).send({ content: chunk })
            }
            this.logger.info(`Successfully posted chat summary to channel ${channelId}`)
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
