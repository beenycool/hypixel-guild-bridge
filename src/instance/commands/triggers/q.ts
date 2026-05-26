import { ChannelType, InstanceType } from '../../../common/application-event.js'
import { calculateSimilarityScore, ChatCommandHandler } from '../../../common/commands.js'
import type { ChatCommandContext } from '../../../common/commands.js'

export default class QCommand extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['q'],
      description: 'Send a one-time message to a different bridge, or list available bridges',
      example: `q list | q blockops hello everyone!`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    context.logger.debug(
      `[q] handler called by ${context.username} args="${context.args.join(' ')}" bridge="${context.message.bridgeId}"`
    )

    if (!context.app.bridgeResolver.isMultiBridgeEnabled()) {
      return `${context.username}, cross-bridge messaging is only available in multi-bridge mode.`
    }

    if (context.args.length === 1 && context.args[0] === 'list') {
      const bridgeIds = context.app.core.bridgeConfigurations.getAllBridgeIds()
      context.logger.debug(`[q] list — bridgeIds=${bridgeIds}`)
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

    const baseEvent = context.eventHelper.fillBaseEvent()
    await context.app.emit('chat', {
      ...baseEvent,

      instanceType: InstanceType.Utility,
      bridgeId: bestBridgeId,

      channelType: ChannelType.Public,
      user: context.message.user,
      message: message
    })

    return `${context.username}, message sent to bridge "${bestBridgeId}".`
  }
}
