import { ChannelType, InstanceType, Permission } from '../../../common/application-event.js'
import { calculateSimilarityScore, ChatCommandHandler } from '../../../common/commands.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { SlidingWindowRateLimiter } from '../../../utility/sliding-window-rate-limiter.js'

const rateLimiter = new SlidingWindowRateLimiter([
  { windowMs: 60_000, maxRequests: 2 },
  { windowMs: 300_000, maxRequests: 5 }
])

export default class QCommand extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Utility',
      triggers: ['chat', 'q'],
      description:
        'Send a one-time message to a different bridge, or manage cross-bridge chat mutes (!chat mute/unmute/muted)',
      example: `chat list | chat mute aidn5 30 | chat blockops hello everyone!`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if (context.args.length === 0) {
      return this.getExample(context.commandPrefix)
    }

    switch (context.args[0].toLowerCase()) {
      case 'mute': {
        return this.mute(context)
      }
      case 'unmute': {
        return this.unmute(context)
      }
      case 'muted': {
        return this.muted(context)
      }
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
    const rateCheck = rateLimiter.check(rateLimitKey)
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

    let bestBridgeId: string | undefined
    let bestScore = -1

    for (const bridgeId of allBridgeIds) {
      const score = calculateSimilarityScore(query, bridgeId)
      if (score > bestScore) {
        bestScore = score
        bestBridgeId = bridgeId
      }
    }

    if (bestBridgeId === undefined || bestScore <= 0) {
      return `${context.username}, no bridge matching "${query}" was found.`
    }

    const sourceBridgeId = context.message.bridgeId
    if (sourceBridgeId !== undefined && bestBridgeId.toLowerCase() === sourceBridgeId.toLowerCase()) {
      return `${context.username}, you are already in that bridge.`
    }

    const enrichedMessage = sourceBridgeId ? `${message} (from ${sourceBridgeId})` : message

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

  private async mute(context: ChatCommandContext): Promise<string> {
    if ((await context.message.user.permission()) < Permission.Officer) {
      return `${context.username}, you must be Officer or higher to use this command.`
    }

    if (context.args.length < 2) {
      return `${context.username}, example: ${context.commandPrefix}chat mute aidn5 30`
    }

    const targetUsername = context.args[1]

    const durationArgument = context.args[2] ?? '30'
    const durationMinutes = Number.parseInt(durationArgument, 10)

    if (Number.isNaN(durationMinutes) || durationMinutes <= 0) {
      return `${context.username}, invalid duration. Please use a number of minutes.`
    }

    const expirationTime = Date.now() + durationMinutes * 60 * 1000
    context.app.core.commandsConfigurations.addQMutedUser(targetUsername, expirationTime)

    return `${targetUsername} has been muted from cross-bridge chat for ${durationMinutes} minute(s).`
  }

  private async unmute(context: ChatCommandContext): Promise<string> {
    if ((await context.message.user.permission()) < Permission.Officer) {
      return `${context.username}, you must be Officer or higher to use this command.`
    }

    if (context.args.length < 2) {
      return `${context.username}, example: ${context.commandPrefix}chat unmute aidn5`
    }

    const targetUsername = context.args[1]

    context.app.core.commandsConfigurations.removeQMutedUser(targetUsername)

    return `${targetUsername} has been unmuted from cross-bridge chat.`
  }

  private async muted(context: ChatCommandContext): Promise<string> {
    if ((await context.message.user.permission()) < Permission.Officer) {
      return `${context.username}, you must be Officer or higher to use this command.`
    }

    const mutedUsers = context.app.core.commandsConfigurations.getQMutedUsers()
    const currentTime = Date.now()
    const activeMutes = mutedUsers.filter((entry) => entry.expirationTime > currentTime)

    if (activeMutes.length === 0) {
      return 'No users are currently muted from cross-bridge chat.'
    }

    const muteList = activeMutes.map((entry) => {
      const remainingMinutes = Math.ceil((entry.expirationTime - currentTime) / 60_000)
      return `${entry.username} (${remainingMinutes}m)`
    })

    return `Currently muted from cross-bridge chat: ${muteList.join(', ')}`
  }
}
