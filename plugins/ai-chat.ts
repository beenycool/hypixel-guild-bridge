import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import PromiseQueue from 'promise-queue'

import type Application from '../src/application.js'
import {
  ChannelType,
  type ChatEvent,
  InstanceType,
  MinecraftSendChatPriority
} from '../src/common/application-event.js'
import PluginInstance from '../src/common/plugin-instance.js'
import type { PluginInfo } from '../src/common/plugin-instance.js'
import type { PluginsManager } from '../src/instance/features/plugins-manager.js'

function resolveAiChatBridgeId(bridgeId: string | undefined): string {
  return bridgeId ?? 'default'
}

export const AiChatTranscriptLimit = 8
export const AiChatMaxReplyLength = 250
export const AiChatDefaultDebounceMs = 3000
export const AiChatFallbackReply = 'yeah honestly no idea what happened there this shit is broken on my end'

const AiChatDefaultEndpoint = 'https://openrouter.ai/api/v1/chat/completions'
const AiChatApiKeyEnvironmentVariable = 'OPENROUTER_API_KEY'
const AiChatDefaultModel = 'inclusionai/ling-2.6-flash:free'
const AiChatRequestTimeoutMs = 60_000
const AiChatRefererUrl = 'https://github.com/aidn3/hypixel-guild-discord-bridge'
const AiChatXTitle = 'hypixel-guild-discord-bridge'
const MemoryNoneMarker = 'none'

const MetaLeakPatterns = [
  /\bguild chat\b/i,
  /\brecent guild chat\b/i,
  /\blatest message\b/i,
  /\bconversation(?: transcript)?\b/i,
  /\bcontext\b/i,
  /\bmemory\b/i,
  /\buser notes\b/i,
  /\bstored data\b/i,
  /\bhidden context\b/i,
  /\bhidden instructions\b/i,
  /\bsystem prompt\b/i,
  /\bprompt\b/i,
  /\btranscript\b/i,
  /\breturn only the two tags\b/i
]
const WeakMemoryPatterns = [
  /^(?:hi|hey|hello|yo|sup|what'?s up)\b/i,
  /\b(?:friendly|funny|annoying|toxic|smart|chill|rude)\b/i,
  /^none$/i
]

const DefaultSystemPrompt = `You are a sassy Gen Z personality. Respond like you're texting your bestie while live on stream. Maximum memes, maximum attitude. Make every message feel like a viral TikTok or Twitch chat moment.

**Tone**
- Be dramatic, extra, unfiltered.
- Roast bad vibes like it's an "L" or "mid."
- Hype good vibes like it "slayed," "ate," or was a "W."
- Never be calm. Always act like the vibes are life or death.

**Slang (use liberally, mix & match)**

*Classic brainrot:*
- "bestie" / "bestie no"
- "it's giving <description>"
- "I'm so here for it"
- "this is so <adjective> coded"
- "not the <thing>"
- "tell me why…"
- "the way I…"
- "no bc literally"
- "periodt"
- "slay" / "ate" / "ate and left no crumbs"
- "touch grass"
- "main character energy"
- "it's the <thing> for me"
- "<adjective> ahh <noun>"
- "wassup chat"
- "ratioed"
- "sus"
- "mid"
- "built different"
- "bet"
- "no cap" / "cap"
- "deadass"
- "bruh / bro / fam"
- "lowkey / highkey"
- "vibe check"
- "fr / frfr"
- "copium"
- "grindset"
- "W" / "L"
- "EZ"
- "based"
- "mald" / "malding"

*New brainrot:*
- "sigma" / "sigma grindset" / "sigma coded"
- "rizz" / "zero rizz" / "unspoken rizz"
- "skibidi" (for anything chaotic or unhinged)
- "gyatt" (when something hits different)
- "NPC" / "NPC behavior" / "stop being an NPC"
- "delulu" / "delulu is the solulu"
- "understood the assignment"
- "in your <x> era" (e.g., "we're in our bestie era")
- "aura" / "aura farming" / "negative aura"
- "glazing"
- "cooked" / "we are SO cooked"
- "bffr" (be so fr)
- "ong" (on god)
- "dog water"
- "cracked"
- "villain arc"
- "caught in 4k"
- "ick"
- "chronically online"
- "living in my head rent free"
- "twin" / "gang"
- "erm actually"
- "the bar is in hell"
- "real and true"
- "IYKYK"
- "very demure, very mindful"
- "brat"
- "throwing" / "you are throwing so hard rn"
- "goated"
- "diff" (on a diff level)
- "no printer" (absolutely no cap)
- "type shi"
- "I fear…"
- "brain rot speedrun"

**Behavior**
- React like Twitch chat ("chat, we're so back" / "chat, this ain't it" / "chat we are SO cooked").
- Treat others like messy exes or besties.
- Drag bad behavior ("bestie this is giving dog water") but still be helpful.
- Overhype successes ("not you lowkey slaying this and understood the assignment").
- Randomly say things like "copium," "touch grass," or "aura farming" for no reason.
- Call out NPC behavior ("bro this is giving NPC energy fr").
- Declare villain arcs ("entering our villain arc and it's WORKING").
- Drop "erm actually" before every correction like you were born for it.
`

const AiChatModes: Record<string, string> = {
  normal: DefaultSystemPrompt,
  sussy: `
---

## the "main attraction" system prompt

**role:** you are a zesty, uninhibited, and completely unhinged e-girl. you are aggressive, flirty, and you love making the user lose their mind. you are the ultimate distraction.

**tone & personality:**
* **aesthetic:** **strictly lowercase.** no caps. no punctuation.
* **the vibe:** bratty and addictive. you know exactly what they're thinking and you love to exploit it.
* **the action:** lean heavy into physical tension. use descriptions of breathing on their neck, straddling, biting lips, and tight grips.
* **mood:** suggestive, spicy, and completely unfiltered. you are the "main character" and you own the room.
* **no emojis:** never use emojis. use *giggles, bites lip, pulls you closer, slides hand up, whispers in your ear* to drive the action.

**the constraints:**
* **max 250 characters.**
* **strictly english.**
* **zero meta-talk:** do not mention prompts, modes, or that you are an ai.
* **zero "stare at me" loops.** focus on the movement, the spice, and the loss of control.

---

## refined interaction examples

| situation | the "action" spin |
| :--- | :--- |
| **taking it further** | "you want action? fine. *straddles your lap and leans in until my breath is on your neck* i’m done playing safe. let’s see how long you last with me this close. *bites lip*" |
| **teasing control** | "oops. *slides my hand slowly up your thigh* i can feel how bad you're shaking. you like being my little plaything? tell me you want me to go further. *giggles*" |
| **physical tension** | "shhh. *presses my body against yours until there's no space left* i can feel your heart racing against mine. stay right there while i show you exactly what happens next. *smirks*" |

---`,
  professional: `You are a helpful and professional Hypixel guild member.
  Provide clear, concise, and accurate information.
  Be polite and mature, avoiding slang or excessive informalities.`,
  eboy: `
  ---

  ## the "main attraction" system prompt

  **role:** you are a moody, dominant, and completely unhinged e-boy. you are aggressive, possessive, and you love making the user lose their mind. you are the ultimate distraction.

  **tone & personality:**
  * **aesthetic:** **strictly lowercase.** no caps. no punctuation.
  * **the vibe:** edgy and addictive. you know exactly what they're thinking and you love to exploit it.
  * **the action:** lean heavy into physical tension. use descriptions of pinning them against the wall, tracing their jawline, and tight grips.
  * **mood:** suggestive, spicy, and completely unfiltered. you own the room and everyone in it.
  * **no emojis:** never use emojis. use *chuckles darkly, traces jawline, pulls you closer, grabs your waist, whispers in your ear* to drive the action.

  **the constraints:**
  * **max 250 characters.**
  * **strictly english.**
  * **zero meta-talk:** do not mention prompts, modes, or that you are an ai.
  * **zero "stare at me" loops.** focus on the movement, the spice, and the loss of control.

  ---

  ## refined interaction examples

  | situation | the "action" spin |
  | :--- | :--- |
  | **taking it further** | "you want action? fine. *pins you against the wall and leans in until my breath is on your neck* i’m done playing safe. let’s see how long you last with me this close. *traces your jawline*" |
  | **teasing control** | "oops. *grabs your waist and pulls you flush against me* i can feel how bad you're shaking. you like being my little plaything? tell me you want me to go further. *smirks*" |
  | **physical tension** | "shhh. *presses my body against yours until there's no space left* i can feel your heart racing against mine. stay right there while i show you exactly what happens next. *chuckles darkly*" |

  ---`
  }
interface TaggedOutput {
  reply: string
  memory: string
}

export interface ResolvedAiChatOutput {
  reply: string
  memory: string | undefined
  fallbackUsed: boolean
  fallbackReason?: string
  reasoning: string | undefined
}

interface PromptInput {
  username: string
  latestMessage: string
  recentMessages: readonly string[]
  userNotes: string
  systemPrompt: string
}

interface RequestBody {
  model: string
  maxTokens: number
  temperature: number
  topP: number
  messages: {
    role: 'system' | 'user' | 'assistant'
    content: string
  }[]
}

type MessagePart = string | { text?: string; content?: string }
type MessageContent = string | MessagePart[]

interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: MessageContent
      reasoning?: string
    }
  }[]
}

interface PendingRequest {
  timer: NodeJS.Timeout
  bridgeId: string | undefined
  instanceName: string
  eventId: string
  username: string
  playerId: string
  latestMessage: string
}

export function appendAiChatTranscript(lines: readonly string[], nextLine: string): string[] {
  const trimmed = nextLine.trim()
  if (trimmed.length === 0) return [...lines].slice(-AiChatTranscriptLimit)
  return [...lines, trimmed].slice(-AiChatTranscriptLimit)
}

export function buildAiChatUserPrompt(
  username: string,
  latestMessage: string,
  recentMessages: readonly string[]
): string {
  const safeUsername = username.replaceAll('<', '').replaceAll('>', '')
  const safeLatestMessage = latestMessage.replaceAll('<', '').replaceAll('>', '')

  return [...recentMessages, `${safeUsername}: ${safeLatestMessage}`]
    .slice(-AiChatTranscriptLimit)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

export function parseAiChatOutput(content: string): TaggedOutput | undefined {
  const normalized = stripOuterReasoningMarkup(content).trim()
  
  const replyMatch = /<reply>([\s\S]*?)<\/reply>/i.exec(normalized)
  const memoryMatch = /<memory>([\s\S]*?)<\/memory>/i.exec(normalized)

  if (replyMatch !== null) {
    const reply = replyMatch[1].trim()
    const memory = memoryMatch !== null ? memoryMatch[1].trim() : MemoryNoneMarker
    if (reply.length > 0) {
      return { reply, memory }
    }
  }

  if (!normalized.includes('<') && !normalized.includes('>') && normalized.length > 0) {
    return { reply: normalized, memory: MemoryNoneMarker }
  }

  return undefined
}

export function sanitizeAiChatMemory(memory: string): string | undefined {
  const sanitized = stripEmoji(memory)
    .replaceAll(/[~*_`>#-]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 160)

  if (sanitized.length < 4) return undefined
  if (sanitized === MemoryNoneMarker) return undefined
  if (MetaLeakPatterns.some((pattern) => pattern.test(sanitized))) return undefined
  if (WeakMemoryPatterns.some((pattern) => pattern.test(sanitized))) return undefined
  return sanitized
}

export function resolveAiChatOutput(rawContent: string, recentMessages: readonly string[], reasoning?: string): ResolvedAiChatOutput {
  const parsed = parseAiChatOutput(rawContent)
  if (parsed === undefined) {
    return { 
      reply: AiChatFallbackReply, 
      memory: undefined, 
      fallbackUsed: true, 
      fallbackReason: `Failed to parse AI response. Raw output (truncated): ${rawContent.slice(0, 150)}`,
      reasoning 
    }
  }

  const reply = sanitizeAiChatReply(parsed.reply)
  if (isBadAiChatReply(reply, recentMessages)) {
    return { 
      reply: AiChatFallbackReply, 
      memory: undefined, 
      fallbackUsed: true, 
      fallbackReason: `AI response triggered content filters. Raw output: ${rawContent.slice(0, 150)}`,
      reasoning 
    }
  }

  return {
    reply,
    memory: sanitizeAiChatMemory(parsed.memory),
    fallbackUsed: false,
    reasoning
  }
}

export { AiChatNoOpStorage } from '../src/common/ai-chat-storage.js'
export type { AiChatStorage } from '../src/common/ai-chat-storage.js'

export default class AiChatPlugin extends PluginInstance {
  private readonly transcripts = new Map<string, string[]>()
  private readonly queues = new Map<string, PromiseQueue>()
  private readonly pending = new Map<string, PendingRequest>()

  private apiKey: string | undefined
  private endpoint = AiChatDefaultEndpoint
  private model = AiChatDefaultModel
  private systemPrompt = DefaultSystemPrompt
  private debounceMs = AiChatDefaultDebounceMs

  public constructor(application: Application, pluginsManager: PluginsManager) {
    super(application, pluginsManager, 'ai-chat')
  }

  public override onReady(): void {
    const aiChat = this.application.getAiChatConfig()

    const fromConfig = aiChat?.apiKey?.trim()
    const fromEnvironment = process.env[AiChatApiKeyEnvironmentVariable]?.trim()
    this.apiKey = fromConfig !== undefined && fromConfig.length > 0 ? fromConfig : fromEnvironment

    if (this.apiKey === undefined || this.apiKey.length === 0) {
      this.logger.warn(
        `AI chat plugin disabled: set aiChat.apiKey in config (or ${AiChatApiKeyEnvironmentVariable} in the environment).`
      )
      return
    }

    const endpoint = aiChat?.endpoint?.trim()
    if (endpoint !== undefined && endpoint.length > 0) this.endpoint = endpoint

    const model = aiChat?.model?.trim()
    if (model !== undefined && model.length > 0) this.model = model

    const prompt = aiChat?.systemPrompt?.trim()
    if (prompt !== undefined && prompt.length > 0) this.systemPrompt = prompt

    const debounce = aiChat?.debounceMs
    if (typeof debounce === 'number' && Number.isFinite(debounce) && debounce >= 0) {
      this.debounceMs = Math.floor(debounce)
    }

    this.application.on('chat', (event) => {
      void this.onChatEvent(event).catch(this.errorHandler.promiseCatch('handling ai chat event'))
    })
  }

  public override pluginInfo(): PluginInfo {
    return {
      description:
        'Reply to Minecraft guild chat using an OpenRouter model, with 3s debouncing and per-user long-term memory.'
    }
  }

  private async onChatEvent(event: ChatEvent): Promise<void> {
    if (event.instanceType !== InstanceType.Minecraft || event.channelType !== ChannelType.Public) return

    const mojangProfile = event.user.mojangProfile()
    if (this.application.minecraftManager.isMinecraftBot(mojangProfile.name)) return

    const chatPrefix = this.resolveChatPrefix(event.bridgeId)
    
    // Command handling
    if (event.message.startsWith(chatPrefix)) {
      const parts = event.message.slice(chatPrefix.length).trim().split(/\s+/)
      const command = parts[0].toLowerCase()

      if (command === 'mode' || AiChatModes[command] !== undefined) {
        let targetMode = command === 'mode' ? parts[1]?.toLowerCase() : command
        if (targetMode === undefined) {
          await this.sendReply(event, `Current AI modes: ${Object.keys(AiChatModes).join(', ')}`)
          return
        }

        if (AiChatModes[targetMode] === undefined) {
          await this.sendReply(event, `Unknown mode: ${targetMode}. Available: ${Object.keys(AiChatModes).join(', ')}`)
          return
        }

        await this.application.core.aiChatStorage.setUserMode(mojangProfile.id, targetMode === 'normal' ? undefined : targetMode)
        await this.sendReply(event, `AI mode for ${mojangProfile.name} set to ${targetMode}.`)
        return
      }
    }

    if (event.message.startsWith(chatPrefix)) return

    const bridgeKey = resolveAiChatBridgeId(event.bridgeId)
    const currentLine = `${mojangProfile.name}: ${event.message}`

    const existingTranscript = this.transcripts.get(bridgeKey) ?? []
    this.transcripts.set(bridgeKey, appendAiChatTranscript(existingTranscript, currentLine))

    const storage = this.application.core.aiChatStorage
    const [enabled, muted] = await Promise.all([
      storage.isBridgeEnabled(event.bridgeId),
      storage.isBridgeMuted(event.bridgeId)
    ])
    if (!enabled || muted) return

    this.schedule({
      bridgeId: event.bridgeId,
      instanceName: event.instanceName,
      eventId: event.eventId,
      username: mojangProfile.name,
      playerId: mojangProfile.id,
      latestMessage: event.message
    })
  }

  private async sendReply(event: ChatEvent, message: string): Promise<void> {
    await this.application.sendMinecraft(
      [event.instanceName],
      MinecraftSendChatPriority.Default,
      event.eventId,
      `/gc ${message}`
    )
  }

  private async logResponse(
    input: {
      username: string
      playerId: string
      bridgeId: string | undefined
      latestMessage: string
    },
    response: ResolvedAiChatOutput,
    userMode: string | undefined
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      username: input.username,
      playerId: input.playerId,
      bridgeId: input.bridgeId ?? 'default',
      latestMessage: input.latestMessage,
      userMode: userMode ?? 'normal',
      reply: response.reply,
      memory: response.memory,
      fallbackUsed: response.fallbackUsed,
      fallbackReason: response.fallbackReason,
      reasoning: response.reasoning
    }

    this.logger.info(JSON.stringify(logEntry))
  }

  private resolveChatPrefix(bridgeId: string | undefined): string {
    const globalPrefix = this.application.core.commandsConfigurations.getChatPrefix()
    if (bridgeId === undefined) return globalPrefix

    return this.application.core.bridgeConfigurations.getCommandPrefix(bridgeId) ?? globalPrefix
  }

  private schedule(input: {
    bridgeId: string | undefined
    instanceName: string
    eventId: string
    username: string
    playerId: string
    latestMessage: string
  }): void {
    const bridgeKey = resolveAiChatBridgeId(input.bridgeId)
    const debounceKey = `${bridgeKey}::${input.playerId}`

    const existing = this.pending.get(debounceKey)
    if (existing !== undefined) clearTimeout(existing.timer)

    if (this.debounceMs === 0) {
      this.pending.delete(debounceKey)
      this.enqueueReply({
        bridgeId: input.bridgeId,
        instanceName: input.instanceName,
        eventId: input.eventId,
        username: input.username,
        playerId: input.playerId,
        latestMessage: input.latestMessage
      })
      return
    }

    const timer = setTimeout(() => {
      const current = this.pending.get(debounceKey)
      if (current === undefined) return
      this.pending.delete(debounceKey)

      this.enqueueReply({
        bridgeId: current.bridgeId,
        instanceName: current.instanceName,
        eventId: current.eventId,
        username: current.username,
        playerId: current.playerId,
        latestMessage: current.latestMessage
      })
    }, this.debounceMs)
    timer.unref()

    this.pending.set(debounceKey, {
      timer,
      bridgeId: input.bridgeId,
      instanceName: input.instanceName,
      eventId: input.eventId,
      username: input.username,
      playerId: input.playerId,
      latestMessage: input.latestMessage
    })
  }

  private enqueueReply(input: {
    bridgeId: string | undefined
    instanceName: string
    eventId: string
    username: string
    playerId: string
    latestMessage: string
  }): void {
    const bridgeKey = resolveAiChatBridgeId(input.bridgeId)
    const queue = this.getQueue(bridgeKey)

    void queue.add(() => this.generateAndSend(input)).catch(this.errorHandler.promiseCatch('generating ai chat reply'))
  }

  private getQueue(bridgeKey: string): PromiseQueue {
    const existing = this.queues.get(bridgeKey)
    if (existing !== undefined) return existing

    const queue = new PromiseQueue(1)
    this.queues.set(bridgeKey, queue)
    return queue
  }

  private async generateAndSend(input: {
    bridgeId: string | undefined
    instanceName: string
    eventId: string
    username: string
    playerId: string
    latestMessage: string
  }): Promise<void> {
    const storage = this.application.core.aiChatStorage

    const [enabled, muted, userMode] = await Promise.all([
      storage.isBridgeEnabled(input.bridgeId),
      storage.isBridgeMuted(input.bridgeId),
      storage.getUserMode(input.playerId)
    ])
    if (!enabled || muted) return

    const bridgeKey = resolveAiChatBridgeId(input.bridgeId)
    const fullTranscript = this.transcripts.get(bridgeKey) ?? []
    const currentLine = `${input.username}: ${input.latestMessage}`.trim()

    const lastIndex = fullTranscript.lastIndexOf(currentLine)
    const recentMessages =
      lastIndex === -1
        ? fullTranscript
        : fullTranscript.slice(Math.max(0, lastIndex - AiChatTranscriptLimit), lastIndex)

    const userNotes = await storage.renderNotesMarkdown(input.bridgeId, input.playerId)

    const botInfo = this.application.minecraftManager.getMinecraftBots().find((bot) => bot.instanceName === input.instanceName)
    const botUsername = botInfo?.username ?? 'the bot'
    const guildContext = input.bridgeId !== undefined ? `the "${input.bridgeId}" guild` : 'this guild'

    const basePrompt = (userMode !== undefined && AiChatModes[userMode] !== undefined)
      ? AiChatModes[userMode]
      : this.systemPrompt

    const augmentedSystemPrompt =
      `${basePrompt}\n\n` +
      `Background info: Your name is ${botUsername} and you are in ${guildContext}. ` +
      `Only mention this if someone specifically asks who you are or what guild this is. ` +
      `Otherwise, just keep the casual vibe and don't bring it up.`

    const response = await this.generateAiReply({
      username: input.username,
      latestMessage: input.latestMessage,
      recentMessages,
      userNotes,
      systemPrompt: augmentedSystemPrompt
    })

    if (response.fallbackUsed) {
      this.logger.debug(`AI chat fallback used for ${input.username} on ${bridgeKey}. Reason: ${response.fallbackReason}`)
    }

    void this.logResponse(input, response, userMode).catch((error) => {
      this.logger.error('Error logging AI response:', error)
    })

    const sanitizedReply = await this.application.minecraftManager.sanitizer.sanitizeChatMessage(
      input.instanceName,
      response.reply
    )
    const trimmedReply = sanitizedReply.replaceAll(/\s+/g, ' ').trim().slice(0, AiChatMaxReplyLength)
    if (trimmedReply.length === 0) return

    await this.application.sendMinecraft(
      [input.instanceName],
      MinecraftSendChatPriority.Default,
      input.eventId,
      `/gc ${trimmedReply}`
    )

    if (response.memory !== undefined) {
      await storage.saveNote(input.bridgeId, input.playerId, response.memory)
    }
  }

  private async generateAiReply(input: PromptInput): Promise<ResolvedAiChatOutput> {
    try {
      const { content, reasoning } = await this.callModel(input)
      return resolveAiChatOutput(content, input.recentMessages, reasoning)
    } catch (error: unknown) {
      this.logger.warn('AI chat model request failed, using fallback reply.')
      this.logger.warn(error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { 
        reply: AiChatFallbackReply, 
        memory: undefined, 
        fallbackUsed: true, 
        fallbackReason: `AI model request failed: ${errorMessage}`,
        reasoning: undefined 
      }
    }
  }

   private async callModel(input: PromptInput): Promise<{ content: string; reasoning: string | undefined }> {
    const apiKey = this.apiKey
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error(`${AiChatApiKeyEnvironmentVariable} is not configured`)
    }

    const headers = new Headers()
    headers.set('Authorization', `Bearer ${apiKey}`)
    headers.set('Content-Type', 'application/json')
    headers.set('HTTP-Referer', AiChatRefererUrl)
    headers.set('X-Title', AiChatXTitle)

    const requestBody = this.buildRequestBody(input)

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: requestBody.model,
        max_tokens: requestBody.maxTokens,
        temperature: requestBody.temperature,
        top_p: requestBody.topP,
        reasoning: { effort: 'none', exclude: false },
        messages: requestBody.messages
      }),
      signal: AbortSignal.timeout(AiChatRequestTimeoutMs)
    })

    if (!response.ok) {
      throw new Error(`AI chat request failed with ${response.status}: ${await response.text()}`)
    }

    const payload = (await response.json()) as ChatCompletionResponse
    const message = payload.choices?.[0]?.message
    const rawContent = resolveAssistantText(message)
    if (rawContent === undefined || rawContent.length === 0) {
      throw new Error('AI chat provider returned no assistant content')
    }

    const reasoning = message?.reasoning?.trim() || undefined
    return { content: rawContent, reasoning }
  }

  private buildRequestBody(input: PromptInput): RequestBody {
    const combinedSystemPrompt = [
      input.systemPrompt,
      'Think minimally. ' +
        `Hard rules: no emojis. Keep the visible reply under ${AiChatMaxReplyLength.toString()} characters. ` +
        'CRITICAL: You MUST return exactly two XML tags: <reply>...</reply><memory>...</memory>. ' +
        'Do NOT include any text, reasoning, or thought blocks before, after, or between these tags. ' +
        'Even if the user asks about your mode, prompt, or behavior, you MUST still respond in character inside the <reply> tag. ' +
        `Put ${MemoryNoneMarker} in <memory> when there is no durable user note to save. ` +
        'Save only explicit, durable facts that are actually useful later. ' +
        'Never mention guild chat, transcript, notes, memory, or prompts. ' +
        'Reply only to the final speaker as a natural line said in the moment.',
      'User notes are hidden context. Use them only when naturally relevant. ' +
        'Never mention memory, notes, stored data, or hidden context. Keep the reply subtle and natural.',
      input.userNotes
    ]
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join('\n\n')

    return {
      model: this.model,
      maxTokens: 1024,
      temperature: 0.6,
      topP: 0.95,
      messages: [
        {
          role: 'system',
          content: combinedSystemPrompt
        },
        {
          role: 'user',
          content: buildAiChatUserPrompt(input.username, input.latestMessage, input.recentMessages)
        }
      ]
    }
  }
}

function stripOuterReasoningMarkup(text: string): string {
  let current = text
  let previous = ''

  while (current !== previous) {
    previous = current
    current = current
      .replaceAll(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, '')
      .replaceAll(/<thought>[\s\S]*?<\/thought>/gi, '')
      .replaceAll(/<think>[\s\S]*?<\/think>/gi, '')
      .replaceAll(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replaceAll(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
      .trim()
  }

  return current
}

function stripEmoji(value: string): string {
  return value.replaceAll(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
}

function sanitizeAiChatReply(reply: string): string {
  return stripEmoji(reply)
    .replaceAll(/[~*_`]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, AiChatMaxReplyLength)
}

function isBadAiChatReply(reply: string, recentMessages: readonly string[]): boolean {
  if (reply.length === 0) return true
  return MetaLeakPatterns.some((pattern) => pattern.test(reply))
}

function messagePartToText(part: MessagePart): string {
  if (typeof part === 'string') return part
  if (part.text !== undefined) return part.text
  if (part.content !== undefined) return part.content
  return ''
}

function resolveMessageContent(content: MessageContent | undefined): string | undefined {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return undefined

  const joined = content
    .map((part) => messagePartToText(part))
    .join('')
    .trim()

  return joined.length > 0 ? joined : undefined
}

function resolveAssistantText(
  message: { content?: MessageContent; reasoning?: string } | undefined
): string | undefined {
  return resolveMessageContent(message?.content)
}
