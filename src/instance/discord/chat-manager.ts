import type { Client, Message } from 'discord.js'

import type { InstanceType } from '../../common/application-event.js'
import { ChannelType } from '../../common/application-event.js'
import SubInstance from '../../common/sub-instance'

import { FilteredReaction } from './common/discord-config.js'
import type MessageAssociation from './common/message-association.js'
import type DiscordInstance from './discord-instance.js'

export default class ChatManager extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  private readonly lastUnmappedChannelWarn = new Map<string, number>()
  private readonly suppressedWarnings = new Map<string, number>()

  private readonly messageAssociation: MessageAssociation
  private readonly sweepInterval: NodeJS.Timeout

  constructor(clientInstance: DiscordInstance, messageAssociation: MessageAssociation) {
    super(clientInstance)
    this.messageAssociation = messageAssociation

    this.sweepInterval = setInterval(
      () => {
        this.sweepWarningMaps()
      },
      30 * 60 * 1000
    )
  }

  override registerEvents(client: Client): void {
    client.on('messageCreate', (message) => {
      void this.onMessage(message).catch(
        this.errorHandler.promiseCatch('handling incoming discord messageCreate event')
      )
    })
  }

  private async onMessage(event: Message): Promise<void> {
    if (event.author.bot) return

    const bridgeResolver = this.application.bridgeResolver

    const bridgeId = bridgeResolver.getBridgeIdForChannel(event.channel.id)
    const bridgeChannelType = bridgeResolver.getChannelTypeForChannel(event.channel.id)

    let channelType: ChannelType
    if (bridgeChannelType === 'public') {
      channelType = ChannelType.Public
    } else if (bridgeChannelType === 'officer') {
      channelType = ChannelType.Officer
    } else if (event.guildId) {
      const now = Date.now()
      const last = this.lastUnmappedChannelWarn.get(event.channel.id) ?? 0
      const suppressMs = 5 * 60 * 1000
      if (now - last > suppressMs) {
        this.lastUnmappedChannelWarn.set(event.channel.id, now)
        const count = this.suppressedWarnings.get(event.channel.id) ?? 0
        this.suppressedWarnings.set(event.channel.id, 0)
        if (count > 0) {
          this.logger.warn(
            `Ignoring guild message in unmapped channel ${event.channel.id} (suppressed ${count} warnings)`
          )
        } else {
          this.logger.warn(`Ignoring guild message in unmapped channel ${event.channel.id}`)
        }
      } else {
        this.suppressedWarnings.set(event.channel.id, (this.suppressedWarnings.get(event.channel.id) ?? 0) + 1)
      }
      return
    } else {
      channelType = ChannelType.Private
    }

    const userProfile = this.clientInstance.profileByUser(event.author, event.member ?? undefined)
    const user = await this.application.core.initializeDiscordUser(userProfile, {})

    const readableReplyUsername = await this.getReplyUsername(event)

    const content = await this.cleanMessage(event)
    if (content.length === 0) return

    const fillBaseEvent = this.eventHelper.fillBaseEvent()
    this.messageAssociation.addMessageId(fillBaseEvent.eventId, {
      guildId: event.guildId ?? undefined,
      channelId: event.channelId,
      messageId: event.id
    })

    const { filteredMessage, changed } = this.application.core.filterProfanityForBridge(content, bridgeId)
    if (changed) {
      this.application.core.recordFilteredMessage(filteredMessage)
      const emoji = this.clientInstance.emojiHandler.emojiByName.get(FilteredReaction.name)
      if (emoji !== undefined) await event.react(emoji)
    }

    await this.application.emit('chat', {
      ...fillBaseEvent,

      channelType: channelType,
      channelId: event.channel.id,
      bridgeId: bridgeId,

      user: user,
      replyUsername: readableReplyUsername,
      message: filteredMessage
    })
  }

  private async getReplyUsername(messageEvent: Message): Promise<string | undefined> {
    if (messageEvent.reference?.messageId === undefined) return

    const messageId = messageEvent.reference.messageId

    const minecraftUsername = this.messageAssociation.getUsernameForMessage(messageId)
    if (minecraftUsername !== undefined) return minecraftUsername

    const channel = messageEvent.channel
    const replyMessage = await channel.messages.fetch(messageId)

    const resolvedProfile = this.clientInstance.profileByUser(replyMessage.author, replyMessage.member ?? undefined)
    const replyUser = await this.application.core.initializeDiscordUser(resolvedProfile, {})

    return replyUser.displayName()
  }

  private cleanGuildEmoji(message: string): string {
    return message.replaceAll(/<:(\w+):\d{16,}>/g, (match) => {
      return match.slice(1, -1).replaceAll(/\d{16,}/g, '')
    })
  }

  private async cleanMessage(messageEvent: Message): Promise<string> {
    let content = messageEvent.cleanContent

    content = this.cleanGuildEmoji(content).trim()

    if (messageEvent.attachments.size > 0) {
      for (const [, attachment] of messageEvent.attachments) {
        if (attachment.contentType?.includes('image') === true || attachment.contentType?.includes('video') === true) {
          const link = attachment.url
          content += ` ${link}`
        } else {
          content += ' (ATTACHMENT)'
        }
      }
    }

    content = await this.resolveUnresolvedMentions(messageEvent, content)

    return content
  }

  private static readonly ResolvedMentionCache = new Map<string, { name: string; timestamp: number }>()
  private static readonly ResolvedMentionCacheTtl = 5 * 60 * 1000

  private static readonly UnresolvedUserMentionRegex = /<@!?(\d{17,19})>/g
  private static readonly UnresolvedRoleMentionRegex = /<@&(\d{17,19})>/g
  private static readonly UnresolvedChannelMentionRegex = /<#(\d{17,19})>/g

  private async resolveUnresolvedMentions(messageEvent: Message, content: string): Promise<string> {
    let result = content

    if (messageEvent.inGuild()) {
      const guild = messageEvent.guild

      result = result.replace(ChatManager.UnresolvedRoleMentionRegex, (match, id: string) => {
        const role = guild.roles.cache.get(id)
        return role === undefined ? match : `@${role.name}`
      })
      result = result.replace(ChatManager.UnresolvedChannelMentionRegex, (match, id: string) => {
        const channel = guild.channels.cache.get(id)
        return channel === undefined ? match : `#${channel.name}`
      })
    }

    const ids = [...new Set([...result.matchAll(ChatManager.UnresolvedUserMentionRegex)].map((m) => m[1]))]
    if (ids.length === 0) return result

    const guild = messageEvent.guild
    const resolveName = async (id: string): Promise<string | undefined> => {
      const cacheKey = `${messageEvent.guildId ?? 'dm'}:${id}`
      const cached = ChatManager.ResolvedMentionCache.get(cacheKey)
      if (cached !== undefined && Date.now() - cached.timestamp < ChatManager.ResolvedMentionCacheTtl) {
        return cached.name
      }

      const member =
        guild === null
          ? undefined
          : (guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => undefined)))
      if (member !== undefined) {
        ChatManager.setResolvedMentionCache(cacheKey, member.displayName)
        return member.displayName
      }

      const user =
        messageEvent.client.users.cache.get(id) ?? (await messageEvent.client.users.fetch(id).catch(() => undefined))
      if (user !== undefined) {
        ChatManager.setResolvedMentionCache(cacheKey, user.username)
        return user.username
      }

      return undefined
    }

    const nameById = new Map<string, string>()
    for (const [id, name] of await Promise.all(ids.map(async (id) => [id, await resolveName(id)] as const))) {
      if (name !== undefined) nameById.set(id, name)
    }

    result = result.replace(ChatManager.UnresolvedUserMentionRegex, (match, id: string) => {
      const name = nameById.get(id)
      return name === undefined ? match : `@${name}`
    })

    return result
  }

  private static setResolvedMentionCache(cacheKey: string, name: string): void {
    ChatManager.ResolvedMentionCache.set(cacheKey, { name, timestamp: Date.now() })

    if (ChatManager.ResolvedMentionCache.size <= 500) return
    const now = Date.now()
    for (const [key, value] of ChatManager.ResolvedMentionCache.entries()) {
      if (now - value.timestamp > ChatManager.ResolvedMentionCacheTtl) ChatManager.ResolvedMentionCache.delete(key)
    }
  }

  private sweepWarningMaps(): void {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000
    for (const map of [this.lastUnmappedChannelWarn, this.suppressedWarnings]) {
      for (const [key, timestamp] of map) {
        if (now - timestamp > maxAge) map.delete(key)
      }
    }
  }

  public override dispose(): void {
    clearInterval(this.sweepInterval)
  }
}
