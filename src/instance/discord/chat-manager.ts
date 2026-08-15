import assert from 'node:assert'

import type { Client, Message } from 'discord.js'

import { ChannelType, InstanceType, MinecraftSendChatPriority } from '../../common/application-event.js'
import SubInstance from '../../common/sub-instance'

import { FilteredReaction, UnverifiedReaction } from './common/discord-config.js'
import type MessageAssociation from './common/message-association.js'
import type DiscordInstance from './discord-instance.js'

export default class ChatManager extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  private static readonly WarnVerificationEvery = 10 * 60 * 1000
  private readonly lastVerificationWarn = new Map<string, number>()

  private readonly lastUnmappedChannelWarn = new Map<string, number>()
  private readonly unmappedChannelSuppressed = new Map<string, number>()

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

    const config = this.application.core.discordConfigurations
    const bridgeResolver = this.application.bridgeResolver

    const bridgeId = bridgeResolver.getBridgeIdForChannel(event.channel.id)
    const bridgeChannelType = bridgeResolver.getChannelTypeForChannel(event.channel.id)

    let channelType: ChannelType
    if (bridgeResolver.isMultiBridgeEnabled() && bridgeChannelType !== undefined) {
      channelType = bridgeChannelType === 'public' ? ChannelType.Public : ChannelType.Officer
    } else if (config.getPublicChannelIds().includes(event.channel.id)) {
      channelType = ChannelType.Public
    } else if (config.getOfficerChannelIds().includes(event.channel.id)) {
      channelType = ChannelType.Officer
    } else if (event.guildId) {
      if (bridgeResolver.isMultiBridgeEnabled()) {
        const now = Date.now()
        const last = this.lastUnmappedChannelWarn.get(event.channel.id) ?? 0
        const suppressMs = 5 * 60 * 1000
        if (now - last > suppressMs) {
          this.lastUnmappedChannelWarn.set(event.channel.id, now)
          const suppressed = this.unmappedChannelSuppressed.get(event.channel.id) ?? 0
          this.unmappedChannelSuppressed.set(event.channel.id, 0)
          if (suppressed > 0) {
            this.logger.warn(
              `Ignoring guild message in unmapped channel ${event.channel.id} while multi-bridge routing is enabled (suppressed ${suppressed} similar warnings in the last ${Math.floor(
                suppressMs / 1000
              )}s)`
            )
          } else {
            this.logger.warn(
              `Ignoring guild message in unmapped channel ${event.channel.id} while multi-bridge routing is enabled`
            )
          }
        } else {
          this.unmappedChannelSuppressed.set(
            event.channel.id,
            (this.unmappedChannelSuppressed.get(event.channel.id) ?? 0) + 1
          )
        }
      }
      return
    } else {
      channelType = ChannelType.Private
    }

    const userProfile = this.clientInstance.profileByUser(event.author, event.member ?? undefined)
    const user = await this.application.core.initializeDiscordUser(userProfile, {})

    if (!user.verified() && config.getEnforceVerification()) {
      const emoji = this.clientInstance.emojiHandler.emojiByName.get(UnverifiedReaction.name)
      if (emoji !== undefined) await event.react(emoji)

      const currentTimestamp = Date.now()
      if (
        (this.lastVerificationWarn.get(event.author.id) ?? 0) + ChatManager.WarnVerificationEvery <
        currentTimestamp
      ) {
        this.lastVerificationWarn.set(event.author.id, currentTimestamp)
        assert.ok(event.inGuild())
        const commands = await event.guild.commands.fetch()
        const linkCommand = commands.find((command) => command.name === 'link')

        await event.reply({
          content:
            `**Verification Warning:**\n` +
            `You can not talk in this channel unless you </link:${linkCommand?.id}> (press the blue link button here) first.`
        })
      }
      return
    }

    const readableReplyUsername = await this.getReplyUsername(event)

    const content = this.cleanMessage(event)
    if (content.length === 0) return

    if (await this.handlePassthroughCommand(event, content, channelType, bridgeId)) {
      return
    }

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
    if (replyMessage.webhookId != undefined) return replyMessage.author.username

    const resolvedProfile = this.clientInstance.profileByUser(replyMessage.author, replyMessage.member ?? undefined)
    const replyUser = await this.application.core.initializeDiscordUser(resolvedProfile, {})

    return replyUser.displayName()
  }

  private cleanGuildEmoji(message: string): string {
    return message.replaceAll(/<:(\w+):\d{16,}>/g, (match) => {
      return match.slice(1, -1).replaceAll(/\d{16,}/g, '')
    })
  }

  private cleanMessage(messageEvent: Message): string {
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

    return content
  }

  private sweepWarningMaps(): void {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000
    for (const map of [this.lastVerificationWarn, this.lastUnmappedChannelWarn, this.unmappedChannelSuppressed]) {
      for (const [key, timestamp] of map) {
        if (now - timestamp > maxAge) map.delete(key)
      }
    }
  }

  private async handlePassthroughCommand(
    event: Message,
    content: string,
    channelType: ChannelType,
    bridgeId: string | undefined
  ): Promise<boolean> {
    if (channelType !== ChannelType.Public) return false

    const bridgeConfig = this.application.core.bridgeConfigurations
    const globalCommandsConfig = this.application.core.commandsConfigurations

    const passthroughPrefix =
      bridgeId === undefined
        ? globalCommandsConfig.getPassthroughPrefix()
        : (bridgeConfig.getPassthroughPrefix(bridgeId) ?? globalCommandsConfig.getPassthroughPrefix())

    if (!content.startsWith(passthroughPrefix)) return false

    const passthroughCommands =
      bridgeId !== undefined && bridgeConfig.getPassthroughCommands(bridgeId).length > 0
        ? bridgeConfig.getPassthroughCommands(bridgeId)
        : globalCommandsConfig.getPassthroughCommands()

    if (passthroughCommands.length === 0) return false

    const messageWithoutPrefix = content.slice(passthroughPrefix.length)
    const commandName = messageWithoutPrefix.split(/\s+/)[0]?.toLowerCase()
    if (!commandName) return false

    const isPassthroughCommand = passthroughCommands.some((cmd) => cmd.toLowerCase() === commandName)
    if (!isPassthroughCommand) return false

    if (this.application.bridgeResolver.isMultiBridgeEnabled() && bridgeId === undefined) {
      this.logger.warn(
        `Dropping passthrough command from unmapped channel ${event.channel.id} while multi-bridge routing is enabled`
      )
      return true
    }

    const instances = this.application
      .getInstancesNames(InstanceType.Minecraft)
      .filter((name) => this.application.bridgeResolver.shouldProcessEvent(bridgeId, name))

    if (instances.length === 0) {
      this.logger.warn('No Minecraft instances available for passthrough command')
      return false
    }

    const gcCommand = `/gc ${content}`
    await this.application.sendMinecraft(instances, MinecraftSendChatPriority.Default, undefined, gcCommand)

    return true
  }

  public override dispose(): void {
    clearInterval(this.sweepInterval)
  }
}
