import { ChannelType, InstanceType } from '../../../common/application-event.js'
import { calculateSimilarityScore, ChatCommandHandler } from '../../../common/commands.js'
import type { ChatCommandContext } from '../../../common/commands.js'

const rateLimitWindows = [
  { window: 60_000, max: 2 },
  { window: 300_000, max: 5 }
]
const userTimestamps = new Map<string, number[]>()

const CLEANUP_INTERVAL_MS = 300_000
const MAX_WINDOW_MS = 300_000
setInterval(() => {
  const cutoff = Date.now() - MAX_WINDOW_MS
  for (const [key, timestamps] of userTimestamps) {
    const recent = timestamps.filter((t) => t > cutoff)
    if (recent.length === 0) {
      userTimestamps.delete(key)
    } else {
      userTimestamps.set(key, recent)
    }
  }
}, CLEANUP_INTERVAL_MS).unref()

function checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const timestamps = userTimestamps.get(key) ?? []
  let maxRetry = 0
  for (const { window, max } of rateLimitWindows) {
    const recent = timestamps.filter((t) => now - t < window)
    if (recent.length >= max) {
      const retry = window - (now - recent[0])
      if (retry > maxRetry) maxRetry = retry
    }
  }
  if (maxRetry > 0) {
    return { allowed: false, retryAfterMs: maxRetry }
  }
  const cleaned = timestamps.filter((t) => now - t < 300_000)
  cleaned.push(now)
  userTimestamps.set(key, cleaned)
  return { allowed: true, retryAfterMs: 0 }
}

export default class QCommand extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Utility',
      triggers: ['chat', 'q'],
      description: 'Send a one-time message to a different bridge, or list available bridges',
      example: `chat list | chat blockops hello everyone!`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if (!context.app.bridgeResolver.isMultiBridgeEnabled()) {
      return `${context.username}, cross-bridge messaging is only available in multi-bridge mode.`
    }

    if (context.args.length === 1 && context.args[0] === 'list') {
      const bridgeIds = context.app.core.bridgeConfigurations.getAllBridgeIds()
      if (bridgeIds.length === 0) {
        return `${context.username}, no bridges are configured.`
      }
      const sourceBridgeId = context.message.bridgeId
      const withMarkers = bridgeIds.map((id) =>
        sourceBridgeId !== undefined && id.toLowerCase() === sourceBridgeId.toLowerCase() ? `${id} (current)` : id
      )
      return `${context.username}, available bridges: ${withMarkers.join(', ')}`
    }

    // Check if user is muted from cross-bridge chat
    const mutedUsers = context.app.core.commandsConfigurations.getQMutedUsers()
    const currentTime = Date.now()
    const isMuted = mutedUsers.some(
      (entry) => entry.username.toLowerCase() === context.username.toLowerCase() && entry.expirationTime > currentTime
    )
    if (isMuted) {
      return `${context.username}, you are muted from cross-bridge chat.`
    }

    const rateLimitKey =
      context.message.user.discordProfile()?.id ??
      context.message.user.mojangProfile()?.id ??
      context.message.user.displayName()
    const rateCheck = checkRateLimit(rateLimitKey)
    if (!rateCheck.allowed) {
      const seconds = Math.ceil(rateCheck.retryAfterMs / 1000)
      return `${context.username}, you are sending messages too fast. Please wait ${seconds} second(s).`
    }

    if (context.args.length < 2) {
      return this.getExample(context.commandPrefix)
    }

    const query = context.args[0]
    const message = context.args.slice(1).join(' ')

    const allBridgeIds = context.app.core.bridgeConfigurations.getAllBridgeIds()
    if (allBridgeIds.length === 0) {
      return `${context.username}, no bridges are configured.`
    }

    // Find the best matching bridge ID using similarity scoring
    let bestBridgeId: string | undefined
    let bestScore = -1

    for (const bridgeId of allBridgeIds) {
      const score = calculateSimilarityScore(query, bridgeId)
      if (score > bestScore) {
        bestScore = score
        bestBridgeId = bridgeId
      }
    }

    // Require at least a minimal match (score > 0 means some overlap or similarity)
    if (bestBridgeId === undefined || bestScore <= 0) {
      return `${context.username}, no bridge matching "${query}" was found.`
    }

    // Prevent sending to the same bridge the user is currently in
    const sourceBridgeId = context.message.bridgeId
    if (sourceBridgeId !== undefined && bestBridgeId.toLowerCase() === sourceBridgeId.toLowerCase()) {
      return `${context.username}, you are already in that bridge.`
    }

    const enrichedMessage = sourceBridgeId ? `${message} (from ${sourceBridgeId})` : message

    // Emit chat event — DiscordBridge renders it as a Minecraft-style image in destination Discord,
    // MinecraftBridge forwards to destination Minecraft instances.
    // The guild echo is suppressed by public.ts's bot-message filter (no duplicate).
    const rawMessage = `§2Guild > §f${context.username}: ${enrichedMessage}`
    const baseEvent = context.eventHelper.fillBaseEvent()
    await context.app.emit('chat', {
      ...baseEvent,

      instanceType: InstanceType.Utility,
      bridgeId: bestBridgeId,

      channelType: ChannelType.Public,
      user: context.message.user,
      message: enrichedMessage,
      rawMessage: rawMessage
    })

    return `${context.username}, message sent to bridge "${bestBridgeId}".`
  }
}
