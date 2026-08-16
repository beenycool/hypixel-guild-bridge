import assert from 'node:assert'

import type { APIEmbed, ApplicationEmoji, Message, MessageMentionOptions } from 'discord.js'
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType as DiscordChannelType,
  ComponentType,
  escapeMarkdown
} from 'discord.js'
import type { Logger } from 'log4js'

import type { StaticDiscordConfig } from '../../application-config.js'
import type Application from '../../application.js'
import type {
  BaseEvent,
  BroadcastEvent,
  ChatEvent,
  CommandEvent,
  CommandFeedbackEvent,
  GuildGeneralEvent,
  GuildPlayerEvent,
  InstanceReactive,
  InstanceReactiveType,
  InstanceStatus,
  MinecraftReactiveEvent
} from '../../common/application-event.js'
import {
  ChannelType,
  Color,
  GuildPlayerEventType,
  InstanceType,
  MinecraftReactiveEventType
} from '../../common/application-event.js'
import Bridge from '../../common/bridge.js'
import type UnexpectedErrorHandler from '../../common/unexpected-error-handler.js'
import type { User } from '../../common/user'
import { beautifyInstanceName } from '../../utility/shared-utility'

import { BlockReaction, GuildMutedReaction } from './common/discord-config.js'
import { InstanceStatusManager } from './common/instance-status-manager'
import type MessageAssociation from './common/message-association.js'
import type { DiscordAssociatedMessage } from './common/message-association.js'
import MessageDeleter from './common/message-deletor.js'
import MessageToImage from './common/message-to-image.js'
import { resolveDiscordMentionsInMessage } from './common/minecraft-discord-mentions.js'
import type { ResolvedDiscordMentions } from './common/minecraft-discord-mentions.js'
import { parseRankChange, RankCompactTracker } from './common/rank-compact-tracker.js'
import type DiscordInstance from './discord-instance.js'

const DASH_SEPARATOR = '-'.repeat(53) + '\n'
const GUILD_PREFIXES = ['§2Guild > ', '§3Officer > ', DASH_SEPARATOR]
const PLAIN_GUILD_PREFIXES = ['Guild > ', 'Officer > ', DASH_SEPARATOR]
const REQUEST_BUTTON_EXPIRY_MS = 5 * 60 * 1000

interface PendingJoinRequest {
  messages: Message[]
  timeout: NodeJS.Timeout
}

export default class DiscordBridge extends Bridge<DiscordInstance> {
  public readonly messageDeleter: MessageDeleter
  public readonly rankCompactTracker = new RankCompactTracker()
  private readonly messageAssociation: MessageAssociation
  private readonly messageToImage

  private readonly instanceStatusManager: InstanceStatusManager

  private readonly staticConfig: Readonly<StaticDiscordConfig>

  private readonly localCleanups: (() => void)[] = []

  private readonly pendingJoinRequests = new Map<string, PendingJoinRequest>()

  private readonly onInstanceReactive = (event: InstanceReactive): void => {
    void this.queue
      .run(async () => this.onInstanceReactiveEvent(event))
      .catch(this.errorHandler.promiseCatch('handling event instanceReactive'))
  }

  private readonly onInterviewMessage = (event: {
    bridgeId: string
    instanceName: string
    username: string
    message: string
  }): void => {
    void this.queue
      .run(() => this.onInterviewMessageEvent(event))
      .catch(this.errorHandler.promiseCatch('handling interview message'))
  }

  constructor(
    application: Application,
    clientInstance: DiscordInstance,
    messageAssociation: MessageAssociation,
    logger: Logger,
    errorHandler: UnexpectedErrorHandler,
    staticDiscordConfig: StaticDiscordConfig
  ) {
    super(application, clientInstance, logger, errorHandler)

    this.messageAssociation = messageAssociation
    this.staticConfig = staticDiscordConfig

    this.messageDeleter = new MessageDeleter(application, errorHandler, this.clientInstance.getClient())
    this.messageToImage = new MessageToImage(application)
    this.instanceStatusManager = new InstanceStatusManager(
      this.application,
      this.clientInstance,
      this.messageAssociation,
      this.errorHandler
    )

    this.application.on('instanceReactive', this.onInstanceReactive)
    this.localCleanups.push(() => {
      this.application.off('instanceReactive', this.onInstanceReactive)
    })

    this.application.on('interviewMessage', this.onInterviewMessage)
    this.localCleanups.push(() => {
      this.application.off('interviewMessage', this.onInterviewMessage)
    })
  }

  override dispose(): void {
    for (const pending of this.pendingJoinRequests.values()) {
      clearTimeout(pending.timeout)
    }
    this.pendingJoinRequests.clear()

    for (const cleanup of this.localCleanups) {
      cleanup()
    }
    super.dispose()
  }

  private joinRequestKey(event: GuildPlayerEvent): string {
    return `${event.instanceName}:${event.user.mojangProfile().id}`
  }

  private registerPendingJoinRequest(key: string, messages: Message[]): void {
    const previous = this.pendingJoinRequests.get(key)
    if (previous !== undefined) {
      clearTimeout(previous.timeout)
    }

    const timeout = setTimeout(() => {
      this.pendingJoinRequests.delete(key)
      this.disableJoinRequestButtons(key, messages).catch(
        this.errorHandler.promiseCatch('disabling join request buttons')
      )
    }, REQUEST_BUTTON_EXPIRY_MS)

    this.pendingJoinRequests.set(key, { messages, timeout })
  }

  private expirePendingJoinRequest(key: string): void {
    const pending = this.pendingJoinRequests.get(key)
    if (pending === undefined) return

    clearTimeout(pending.timeout)
    this.pendingJoinRequests.delete(key)
    this.disableJoinRequestButtons(key, pending.messages).catch(
      this.errorHandler.promiseCatch('disabling join request buttons')
    )
  }

  private async disableJoinRequestButtons(key: string, messages: Message[]): Promise<void> {
    await Promise.all(
      messages.map(async (message) => {
        const disabledRows = message.components.map((row) => {
          const builder = new ActionRowBuilder<ButtonBuilder>()
          if ('components' in row && Array.isArray(row.components)) {
            for (const component of row.components) {
              if (component.type === ComponentType.Button) {
                builder.addComponents(ButtonBuilder.from(component).setDisabled(true))
              }
            }
          }
          return builder
        })

        try {
          await message.edit({ components: disabledRows })
        } catch (error: unknown) {
          this.logger.warn(`Failed to disable join request buttons for ${key}`, error)
        }
      })
    )
  }

  private resolveChannelsForEvent(
    channels: ChannelType[],
    bridgeId: string | undefined,
    routingHint?: { kind: string; instanceName: string }
  ): string[] {
    const bridgeResolver = this.application.bridgeResolver

    const effectiveBridgeId =
      bridgeId ??
      (routingHint === undefined ? undefined : bridgeResolver.getBridgeIdForInstance(routingHint.instanceName))

    let results: string[]
    if (routingHint?.kind === 'broadcast') {
      results = this.resolveAllBridgeChannels(channels)
    } else if (effectiveBridgeId === undefined) {
      results = []
    } else {
      results = this.resolveBridgeScopedChannels(channels, effectiveBridgeId)
    }

    const targetsGuildSurface = channels.includes(ChannelType.Public) || channels.includes(ChannelType.Officer)
    if (targetsGuildSurface && results.length === 0 && routingHint !== undefined) {
      this.logger.warn(
        `Discord routing (${routingHint.kind}): no target channels for instance="${routingHint.instanceName}" ` +
          `(event.bridgeId=${bridgeId ?? 'undefined'}, effectiveBridgeId=${effectiveBridgeId ?? 'undefined'}). ` +
          `Configure this Minecraft instance on a bridge and set public/officer channel IDs in /settings.`
      )
    }

    return results
  }

  private resolveBridgeScopedChannels(channels: ChannelType[], bridgeId: string): string[] {
    const results: string[] = []
    if (channels.includes(ChannelType.Public)) {
      results.push(...this.application.bridgeResolver.getPublicChannelIds(bridgeId))
    }
    if (channels.includes(ChannelType.Officer)) {
      results.push(...this.application.bridgeResolver.getOfficerChannelIds(bridgeId))
    }

    return [...new Set(results)]
  }

  private resolveAllBridgeChannels(channels: ChannelType[]): string[] {
    const results = new Set<string>()

    for (const bridge of this.application.bridgeResolver.getAllBridges()) {
      if (channels.includes(ChannelType.Public)) {
        for (const channelId of bridge.publicChannelIds) results.add(channelId)
      }

      if (channels.includes(ChannelType.Officer)) {
        for (const channelId of bridge.officerChannelIds) results.add(channelId)
      }
    }

    return [...results]
  }

  async onInstance(event: InstanceStatus): Promise<void> {
    if (event.instanceName === this.clientInstance.instanceName) return
    switch (event.instanceType) {
      case InstanceType.Main:
      case InstanceType.Commands:
      case InstanceType.Prometheus:
      case InstanceType.Metrics:
      case InstanceType.Utility:
      case InstanceType.Core: {
        return
      }
    }

    await this.instanceStatusManager.send()
  }

  async onChat(event: ChatEvent): Promise<void> {
    const channels = this.resolveChannelsForEvent([event.channelType], event.bridgeId, {
      kind: 'chat',
      instanceName: event.instanceName
    })
    const username = event.user.displayName()
    const playerOverride =
      event.instanceType !== InstanceType.Minecraft || event.bridgeId === undefined
        ? undefined
        : this.application.core.bridgeConfigurations.getPlayerUsernameOverride(event.bridgeId, username)

    for (const channelId of channels) {
      if (event.instanceType === InstanceType.Discord && channelId === event.channelId) continue

      if (event.instanceType === InstanceType.Minecraft) {
        const mentions = await this.resolveMinecraftMentionsForChannel(channelId, event.message)
        let withoutPrefix = this.removeGuildPrefix(event.rawMessage)
        if (playerOverride !== undefined) {
          withoutPrefix = withoutPrefix.replaceAll(username, playerOverride)
        }
        const formattedMessage = `${this.getRenderedChannelPrefix(event.channelType)}{skin} ${withoutPrefix}`
        const image = await this.messageToImage.generateMessageImage(formattedMessage, {
          username: event.user.displayName()
        })
        const sentMessages = await this.sendImageToChannels(event.eventId, [channelId], image)
        for (const message of sentMessages) {
          this.messageAssociation.addUsernameForMessage(message.id, username)
        }
        if (mentions !== undefined && mentions.userIds.length > 0) {
          const channel = this.clientInstance.getClient().channels.cache.get(channelId)
          if (channel?.isSendable()) {
            await channel.send({
              content: mentions.userIds.map((id) => `<@${id}>`).join(' '),
              allowedMentions: { parse: [], users: mentions.userIds }
            })
          }
        }
      } else if (event.instanceType !== InstanceType.Discord && 'rawMessage' in event) {
        const raw = (event as ChatEvent & { rawMessage: string }).rawMessage
        const withoutPrefix = this.removeGuildPrefix(raw)
        const formattedMessage = `${this.getRenderedChannelPrefix(event.channelType)}${withoutPrefix}`
        const image = await this.messageToImage.generateMessageImage(formattedMessage)
        await this.sendImageToChannels(event.eventId, [channelId], image)
      }
    }
  }

  private async resolveMinecraftMentionsForChannel(
    channelId: string,
    message: string
  ): Promise<ResolvedDiscordMentions | undefined> {
    const channel = this.clientInstance.getClient().channels.cache.get(channelId)
    if (channel === undefined) return undefined
    if (channel.type !== DiscordChannelType.GuildText) return undefined
    try {
      return await resolveDiscordMentionsInMessage(message, channel.guild, async (mcName) => {
        const profile = await this.application.mojangApi.profileByUsername(mcName)
        const link = await this.application.core.verification.findByIngame(profile.id)
        return link?.discordId
      })
    } catch (error) {
      this.logger.warn('Failed to resolve Discord mentions for Minecraft chat', error)
      return undefined
    }
  }

  async onInterviewMessageEvent(event: {
    bridgeId: string
    instanceName: string
    username: string
    message: string
  }): Promise<void> {
    const channels = this.resolveChannelsForEvent([ChannelType.Officer], event.bridgeId, {
      kind: 'interview',
      instanceName: event.instanceName
    })
    if (channels.length === 0) return

    const formattedMessage = `§9Party §8> {skin} ${event.message}`
    try {
      const image = await this.messageToImage.generateMessageImage(formattedMessage, {
        username: event.username
      })
      await this.sendImageToChannels(`interview-${event.instanceName}-${event.username}`, channels, image)
      return
    } catch (error: unknown) {
      this.logger.error('Failed to render interview message as image', error)
    }

    const client = this.clientInstance.getClient()
    for (const channelId of channels) {
      try {
        const channel = await client.channels.fetch(channelId)
        if (!channel?.isSendable()) continue
        await channel.send({
          content: `🔎 **${event.username}** ${event.message}`,
          allowedMentions: { parse: [] }
        })
      } catch (error: unknown) {
        this.logger.error(`Failed to send interview message to ${channelId}`, error)
      }
    }
  }

  async onGuildPlayer(event: GuildPlayerEvent): Promise<void> {
    if (
      event.instanceType === this.clientInstance.instanceType &&
      event.instanceName === this.clientInstance.instanceName
    )
      return

    const effectiveBridgeId =
      event.bridgeId ?? this.application.bridgeResolver.getBridgeIdForInstance(event.instanceName)
    if (effectiveBridgeId === undefined) {
      this.logger.warn(
        `Discord bridge: dropping guildPlayer event (${event.type}) for unmapped instance "${event.instanceName}"`
      )
      return
    }

    const bridgeConfigurations = this.application.core.bridgeConfigurations
    if (event.type === GuildPlayerEventType.Online && !bridgeConfigurations.getGuildOnline(effectiveBridgeId)) return
    if (event.type === GuildPlayerEventType.Offline && !bridgeConfigurations.getGuildOffline(effectiveBridgeId)) return

    if (event.type === GuildPlayerEventType.Leave || event.type === GuildPlayerEventType.Kick) {
      const userId = event.user.mojangProfile().id
      const key = `${effectiveBridgeId}:${userId}`
      this.rankCompactTracker.delete(key)
    }

    let activeEvent = event
    let rankTrackerKey: string | undefined
    const isRankChange = event.type === GuildPlayerEventType.Promote || event.type === GuildPlayerEventType.Demote
    const username = event.user.displayName()
    const playerOverride =
      event.type !== GuildPlayerEventType.Join && event.type !== GuildPlayerEventType.Leave
        ? undefined
        : bridgeConfigurations.getPlayerUsernameOverride(effectiveBridgeId, username)

    if (isRankChange) {
      const parsed = parseRankChange(event.message)
      if (parsed !== undefined) {
        const userId = event.user.mojangProfile().id
        rankTrackerKey = `${effectiveBridgeId}:${userId}`
        const existing = this.rankCompactTracker.get(rankTrackerKey)

        if (existing !== undefined) {
          for (const oldMessage of existing.messages) {
            await oldMessage.delete().catch(() => undefined)
          }

          if (existing.initialRank === parsed.toRank) {
            this.rankCompactTracker.delete(rankTrackerKey)
            return
          }

          const isPromoteType = existing.initialType === GuildPlayerEventType.Promote
          const actionWord = isPromoteType ? 'promoted' : 'demoted'
          const eventColor = isPromoteType ? Color.Good : Color.Bad

          const pattern = /was (?:promoted|demoted) from .+/i
          const replacement = `was ${actionWord} from ${existing.initialRank} to ${parsed.toRank}`

          const compactedMessage = event.message.replace(pattern, replacement)
          let compactedRawMessage = event.rawMessage.replace(pattern, replacement)

          compactedRawMessage =
            actionWord === 'demoted'
              ? compactedRawMessage.replaceAll('§a', '§c')
              : compactedRawMessage.replaceAll('§c', '§a')

          activeEvent = {
            ...event,
            message: compactedMessage,
            rawMessage: compactedRawMessage,
            color: eventColor,
            type: existing.initialType
          }
        }
      }
    }

    let components: ActionRowBuilder<ButtonBuilder>[] | undefined
    let pingContent: string | undefined
    let allowedMentions: MessageMentionOptions | undefined

    if (activeEvent.type === GuildPlayerEventType.Request) {
      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`join-request:accept:${activeEvent.instanceName}:${username}`)
          .setLabel('Accept Request')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`join-request:deny:${activeEvent.instanceName}:${username}`)
          .setLabel('Deny Request')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌'),
        new ButtonBuilder()
          .setCustomId(`guild-req-interrogate:${activeEvent.instanceName}:${username}`)
          .setLabel('Interrogate')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔎')
      )
      components = [actionRow]
    }

    const requestButtonMessages: Message[] = []
    let withoutPrefix = this.removePlainGuildPrefix(this.removeGuildPrefix(activeEvent.rawMessage)).replaceAll(
      /^-+/g,
      ''
    )
    if (playerOverride !== undefined) {
      withoutPrefix = withoutPrefix.replaceAll(username, playerOverride)
    }
    const formattedMessage = `${this.getRenderedChannelPrefix(ChannelType.Public)}{skin} ${withoutPrefix}`

    const messages = await this.sendImageToChannels(
      activeEvent.eventId,
      this.resolveChannelsForEvent(activeEvent.channels, activeEvent.bridgeId, {
        kind: 'guildPlayer',
        instanceName: activeEvent.instanceName
      }),
      await this.messageToImage.generateMessageImage(formattedMessage, {
        username: activeEvent.user.displayName()
      })
    )
    if ((components !== undefined && components.length > 0) || pingContent !== undefined) {
      const targetChannels = this.resolveChannelsForEvent(activeEvent.channels, activeEvent.bridgeId, {
        kind: 'guildPlayer',
        instanceName: activeEvent.instanceName
      })
      for (const channelId of targetChannels) {
        const channel = await this.clientInstance
          .getClient()
          .channels.fetch(channelId)
          .catch(() => undefined)
        if (channel?.isSendable()) {
          requestButtonMessages.push(
            await channel.send({
              ...(pingContent === undefined ? {} : { content: pingContent }),
              ...(components !== undefined && components.length > 0 ? { components } : {}),
              allowedMentions: allowedMentions ?? { parse: [] }
            })
          )
        }
      }
    }

    if (activeEvent.type === GuildPlayerEventType.Request && requestButtonMessages.length > 0) {
      this.registerPendingJoinRequest(this.joinRequestKey(activeEvent), requestButtonMessages)
    }

    if (activeEvent.type === GuildPlayerEventType.Join) {
      this.expirePendingJoinRequest(this.joinRequestKey(activeEvent))
    }

    if (activeEvent.type === GuildPlayerEventType.Offline || activeEvent.type === GuildPlayerEventType.Online) {
      const shouldPersist =
        activeEvent.bridgeId === undefined
          ? false
          : this.application.core.bridgeConfigurations.getPersistGuildOnlineOffline(activeEvent.bridgeId)
      if (!shouldPersist) {
        const currentTime = Date.now()
        const entries = messages.map((message) => ({
          channelId: message.channelId,
          messageId: message.id,
          createdAt: currentTime,
          type: 'online-offline' as const,
          bridgeId: activeEvent.bridgeId
        }))
        await this.messageDeleter.add(entries)
      }
    }

    if (activeEvent.type === GuildPlayerEventType.Join || activeEvent.type === GuildPlayerEventType.Leave) {
      const shouldPersist =
        activeEvent.bridgeId === undefined
          ? false
          : this.application.core.bridgeConfigurations.getPersistGuildJoinLeave(activeEvent.bridgeId)
      if (!shouldPersist) {
        const currentTime = Date.now()
        const entries = messages.map((message) => ({
          channelId: message.channelId,
          messageId: message.id,
          createdAt: currentTime,
          type: 'join-leave' as const,
          bridgeId: activeEvent.bridgeId
        }))
        await this.messageDeleter.add(entries)
      }
    }

    let promoteImageMessages: Message[] = []
    if (activeEvent.type === GuildPlayerEventType.Promote) {
      const promoteChannelIds = this.application.core.bridgeConfigurations.getPromoteChannelIds(effectiveBridgeId)
      if (promoteChannelIds.length > 0) {
        const withoutPrefix = this.removePlainGuildPrefix(this.removeGuildPrefix(activeEvent.rawMessage)).replaceAll(
          /^-+/g,
          ''
        )
        const formattedMessage = `${this.getRenderedChannelPrefix(ChannelType.Public)}{skin} ${withoutPrefix}`

        try {
          const image = await this.messageToImage.generateMessageImage(formattedMessage, {
            username: activeEvent.user.displayName()
          })
          const imageMessages = await this.sendImageToChannels(activeEvent.eventId, promoteChannelIds, image)
          promoteImageMessages = imageMessages
          for (const message of imageMessages) {
            await message.react('🔥').catch((error: unknown) => {
              this.logger.error(error, 'Failed to react to promotion message')
            })
          }
        } catch (error: unknown) {
          this.logger.error(error, 'Failed to generate Minecraft chat image for promotion')
        }
      }
    }

    if (isRankChange && rankTrackerKey !== undefined) {
      const parsed = parseRankChange(event.message)
      if (parsed !== undefined) {
        const existing = this.rankCompactTracker.get(rankTrackerKey)
        const initialRank = existing === undefined ? parsed.fromRank : existing.initialRank
        const initialType =
          existing === undefined
            ? event.type === GuildPlayerEventType.Promote
              ? GuildPlayerEventType.Promote
              : GuildPlayerEventType.Demote
            : existing.initialType

        const allSent = [...messages, ...promoteImageMessages]
        this.rankCompactTracker.set(rankTrackerKey, {
          userId: event.user.mojangProfile().id,
          initialRank,
          currentRank: parsed.toRank,
          initialType,
          timestamp: Date.now(),
          messages: allSent
        })
      }
    }

    if (activeEvent.type === GuildPlayerEventType.Join || activeEvent.type === GuildPlayerEventType.Leave) {
      const bridgeId = this.application.bridgeResolver.getBridgeIdForInstance(activeEvent.instanceName)
      if (bridgeId !== undefined) {
        const emojiType =
          activeEvent.type === GuildPlayerEventType.Join
            ? this.application.core.bridgeConfigurations.getJoinReactionEmojiType(bridgeId)
            : this.application.core.bridgeConfigurations.getLeaveReactionEmojiType(bridgeId)

        if (emojiType !== 'none') {
          const emoji = emojiType === 'thumbsup' ? '👍' : '👎'
          for (const message of messages) {
            try {
              await message.react(emoji)
            } catch (error: unknown) {
              this.logger.error(error, 'Failed to react to join/leave announcement message')
            }
          }
        }
      }
    }
  }

  async onGuildGeneral(event: GuildGeneralEvent): Promise<void> {
    if (
      event.instanceType === this.clientInstance.instanceType &&
      event.instanceName === this.clientInstance.instanceName
    )
      return

    const image = this.messageToImage.generateMessageImageSync(event.rawMessage)
    await this.sendImageToChannels(
      event.eventId,
      this.resolveChannelsForEvent(event.channels, event.bridgeId, {
        kind: 'guildGeneral',
        instanceName: event.instanceName
      }),
      image
    )
  }

  private lastMinecraftEvent = new Map<MinecraftReactiveEventType, number>()

  async onMinecraftChatEvent(event: MinecraftReactiveEvent): Promise<void> {
    if ((this.lastMinecraftEvent.get(event.type) ?? 0) + 5000 > Date.now()) return
    this.lastMinecraftEvent.set(event.type, Date.now())

    const client = this.clientInstance.getClient()

    const replyIds = this.messageAssociation.getMessageId(event.originEventId)
    for (const replyId of replyIds) {
      try {
        const channel = await client.channels.fetch(replyId.channelId)
        if (channel?.type === DiscordChannelType.GuildText) {
          const message = await channel.messages.fetch(replyId.messageId)

          let emoji: ApplicationEmoji | undefined = undefined
          switch (event.type) {
            case MinecraftReactiveEventType.Advertise:
            case MinecraftReactiveEventType.Block: {
              emoji = this.clientInstance.emojiHandler.emojiByName.get(BlockReaction.name)
              break
            }
            case MinecraftReactiveEventType.GuildMuted: {
              emoji = this.clientInstance.emojiHandler.emojiByName.get(GuildMutedReaction.name)
              break
            }
          }

          if (emoji != undefined) {
            await message.react(emoji)
            continue
          }
        }

        assert.ok(channel?.isSendable())
        await channel.send({
          files: [new AttachmentBuilder(this.messageToImage.generateMessageImageSync(event.rawMessage))]
        })
      } catch (error: unknown) {
        this.logger.error(error, 'can not reply to message')
      }
    }
  }

  async onBroadcast(event: BroadcastEvent): Promise<void> {
    if (
      event.instanceType === this.clientInstance.instanceType &&
      event.instanceName === this.clientInstance.instanceName
    )
      return

    const channels = this.resolveChannelsForEvent(event.channels, event.bridgeId, {
      kind: 'broadcast',
      instanceName: event.instanceName
    })
    if (event.guildChatImageStyle === undefined) {
      let formatted: string
      switch (event.color) {
        case Color.Good: {
          formatted = `§a`
          break
        }
        case Color.Bad: {
          formatted = `§c`
          break
        }
        case Color.Error: {
          formatted = `§4`
          break
        }
        case Color.Info: {
          formatted = `§e`
          break
        }
        // eslint-disable-next-line unicorn/no-useless-switch-case
        case Color.Default:
        default: {
          formatted = `§b`
        }
      }
      const image = this.messageToImage.generateMessageImageSync(formatted + event.message)
      await this.sendImageToChannels(event.eventId, channels, image)
    } else {
      const { channelType, skinUsername, imageBodyFormatted } = event.guildChatImageStyle
      const prefix = this.getRenderedChannelPrefix(channelType)
      const body =
        imageBodyFormatted !== undefined && imageBodyFormatted.length > 0
          ? imageBodyFormatted
          : event.message.startsWith('§')
            ? event.message
            : `§f${event.message}`
      const formattedMessage = `${prefix}{skin} ${body}`
      const image = await this.messageToImage.generateMessageImage(formattedMessage, {
        username: skinUsername
      })
      await this.sendImageToChannels(event.eventId, channels, image)
    }
  }

  async onCommand(event: CommandEvent): Promise<void> {
    await this.sendCommandResponse(event)
  }

  async onCommandFeedback(event: CommandFeedbackEvent): Promise<void> {
    await this.sendCommandResponse(event)
  }

  private lastInstanceReactiveEvent = new Map<InstanceReactiveType, number>()

  async onInstanceReactiveEvent(event: InstanceReactive): Promise<void> {
    if ((this.lastInstanceReactiveEvent.get(event.type) ?? 0) + 5000 > Date.now()) return
    this.lastInstanceReactiveEvent.set(event.type, Date.now())

    const replyIds = this.messageAssociation.getMessageId(event.originEventId)

    for (const replyId of replyIds) {
      try {
        await this.replyWithEmbed(
          event.eventId,
          replyId,
          await this.generateEmbed({ ...event, type: undefined }, replyId.guildId)
        )
      } catch (error: unknown) {
        this.logger.error(error, 'can not reply to message. sending the event independently')
        await this.sendEmbedToChannels({ ...event, type: undefined }, [replyId.channelId], undefined)
      }
    }
  }

  private removeGuildPrefix(message: string): string {
    let finalMessage = message
    for (const prefix of GUILD_PREFIXES) {
      if (finalMessage.startsWith(prefix)) finalMessage = finalMessage.slice(prefix.length)
    }

    return finalMessage
  }

  private removePlainGuildPrefix(message: string): string {
    let finalMessage = message
    for (const prefix of PLAIN_GUILD_PREFIXES) {
      if (finalMessage.startsWith(prefix)) finalMessage = finalMessage.slice(prefix.length)
    }

    return finalMessage
  }

  private getChannelPrefix(channelType: ChannelType): string {
    switch (channelType) {
      case ChannelType.Officer: {
        return 'Officer > '
      }
      case ChannelType.Public: {
        return 'Guild > '
      }
      default: {
        return ''
      }
    }
  }

  private getRenderedChannelPrefix(channelType: ChannelType): string {
    switch (channelType) {
      case ChannelType.Officer: {
        return '§3Officer §3> '
      }
      case ChannelType.Public: {
        return '§2Guild §2> '
      }
      default: {
        return ''
      }
    }
  }

  private async generateEmbed(event: GenerateEmbedType, guildId: string | undefined): Promise<APIEmbed> {
    const embed: APIEmbed = {
      description: escapeMarkdown(event.message),

      footer: { text: beautifyInstanceName(event.instanceName) }
    } satisfies APIEmbed

    if ('color' in event) {
      embed.color = event.color
    }

    if ('user' in event && event.user != undefined) {
      embed.title = event.user.displayName()
      this.assignAvatar(embed, event.user)
    }

    if ('type' in event && event.type === MinecraftReactiveEventType.RequireGuild && guildId !== undefined) {
      const commands = await this.clientInstance
        .getClient()
        .guilds.fetch(guildId)
        .then((guild) => guild.commands.fetch())
      const joinCommand = commands.find((command) => command.name === 'join')
      const setupCommand = commands.find((command) => command.name === 'setup')

      const adminList = this.staticConfig.adminIds.map((adminId) => `<@${adminId}>`)
      embed.description =
        `Looks like the Minecraft account is not in a guild for this to work.\n` +
        `You can ask ${adminList.join(', ')} or any staff who has access\n` +
        `to set it up using </join:${joinCommand?.id}> before using </setup:${setupCommand?.id}> right after.`
    }

    return embed
  }

  private async replyWithEmbed(eventId: string, replyId: DiscordAssociatedMessage, embed: APIEmbed): Promise<void> {
    const channel = await this.clientInstance.getClient().channels.fetch(replyId.channelId)
    assert.ok(channel != undefined)
    assert.ok(channel.isSendable())

    const result = await channel.send({
      embeds: [embed],
      reply: { messageReference: replyId.messageId },
      allowedMentions: { parse: [] }
    })
    this.messageAssociation.addMessageId(eventId, {
      guildId: result.guildId ?? undefined,
      channelId: result.channelId,
      messageId: result.id
    })
  }

  private async sendEmbedToChannels(
    event: GenerateEmbedType & Pick<BaseEvent, 'eventId'>,
    channels: string[],
    preGeneratedEmbed: APIEmbed | undefined,
    components?: ActionRowBuilder<ButtonBuilder>[],
    content?: string,
    allowedMentions?: MessageMentionOptions
  ): Promise<Message<true>[]> {
    const results = await Promise.all(
      channels.map(async (channelId) => {
        try {
          const channel = await this.clientInstance.getClient().channels.fetch(channelId)
          if (channel == undefined) return
          if (!channel.isSendable() || channel.type !== DiscordChannelType.GuildText) return

          const embed = preGeneratedEmbed ?? (await this.generateEmbed(event, channel.guildId))
          const message = await channel.send({
            ...(content === undefined ? {} : { content }),
            embeds: [embed],
            ...(components !== undefined && components.length > 0 ? { components } : {}),
            allowedMentions: allowedMentions ?? { parse: [] }
          })

          this.messageAssociation.addMessageId(event.eventId, {
            guildId: message.inGuild() ? message.guildId : undefined,
            channelId: message.channelId,
            messageId: message.id
          })
          return message
        } catch (error: unknown) {
          this.logger.error(`error sending to ${channelId}`, error)
          return
        }
      })
    )

    return results.filter((m): m is Message<true> => m !== undefined)
  }

  private async sendImageToChannels(eventId: string, channels: string[], image: Buffer): Promise<Message<true>[]> {
    const results = await Promise.all(
      channels.map(async (channelId) => {
        try {
          const channel = await this.clientInstance.getClient().channels.fetch(channelId)
          if (channel == undefined) return
          if (!channel.isSendable() || channel.type !== DiscordChannelType.GuildText) return

          const message = await channel.send({ files: [{ attachment: image, name: 'image.png' }] })

          this.messageAssociation.addMessageId(eventId, {
            guildId: message.inGuild() ? message.guildId : undefined,
            channelId: message.channelId,
            messageId: message.id
          })
          return message
        } catch (error: unknown) {
          this.logger.error(`error sending to ${channelId}`, error)
          return
        }
      })
    )

    return results.filter((m): m is Message<true> => m !== undefined)
  }

  private async sendCommandResponse(event: CommandEvent): Promise<void> {
    const replyIds = this.messageAssociation.getMessageId(event.originEventId)

    const bots = this.application.minecraftManager.getMinecraftBots()
    let botName = 'Bridge Bot'
    let botInstanceName: string | undefined

    if (event.instanceType === InstanceType.Minecraft) {
      botInstanceName = event.instanceName
      const bot = bots.find((b) => b.instanceName === botInstanceName)
      if (bot) botName = bot.username
    } else {
      const bridgeBots = bots.filter((bot) =>
        this.application.bridgeResolver.shouldProcessEvent(event.bridgeId, bot.instanceName)
      )
      if (bridgeBots.length > 0) {
        botInstanceName = bridgeBots[0].instanceName
        botName = bridgeBots[0].username
      }
    }

    const botUsernameOverride =
      event.bridgeId === undefined
        ? undefined
        : this.application.core.bridgeConfigurations.getBotUsernameOverride(event.bridgeId)
    const effectiveBotName = botUsernameOverride ?? botName

    const botRank = botInstanceName ? this.application.minecraftManager.getBotRank(botInstanceName) : undefined
    const namePart = botRank
      ? botUsernameOverride === undefined
        ? `${botRank}§f`
        : `${botRank.replace(new RegExp(botName, 'i'), botUsernameOverride)}§f`
      : `§a${effectiveBotName}§f`

    const publicChannelIds = this.resolveChannelsForEvent([ChannelType.Public], event.bridgeId, {
      kind: 'command',
      instanceName: event.instanceName
    })
    const isPublicChannel = (channelId: string) => publicChannelIds.includes(channelId)

    for (const replyId of replyIds) {
      try {
        const channelType = isPublicChannel(replyId.channelId) ? ChannelType.Public : ChannelType.Officer

        const formattedMessage = `${this.getRenderedChannelPrefix(channelType)}{skin} ${namePart}: §f${event.commandResponse}`
        const image = await this.messageToImage.generateMessageImage(formattedMessage, {
          username: botName === 'Bridge Bot' ? 'MHF_Question' : botName
        })
        await this.sendImageToChannels(event.eventId, [replyId.channelId], image)
      } catch (error: unknown) {
        this.logger.error(error, 'failed to send command response')
      }
    }
  }

  private assignAvatar(embed: APIEmbed, user: User): void {
    const avatar = user.avatar()
    if (avatar !== undefined) embed.thumbnail = { url: avatar }
    const profileLink = user.profileLink()
    if (profileLink !== undefined) embed.url = profileLink
  }
}

type GenerateEmbedType = Pick<BaseEvent, 'instanceName'> & {
  message: string
  user?: User
  color?: Color
  type?: MinecraftReactiveEventType | undefined
}
