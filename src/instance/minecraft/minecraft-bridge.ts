import assert from 'node:assert'

import type { Logger } from 'log4js'

import type Application from '../../application.js'
import type {
  BaseInGameEvent,
  BroadcastEvent,
  ChatEvent,
  CommandEvent,
  CommandFeedbackEvent,
  GuildGeneralEvent,
  GuildPlayerEvent,
  InstanceStatus,
  MinecraftReactiveEvent
} from '../../common/application-event.js'
import {
  ChannelType,
  GuildPlayerEventType,
  InstanceMessageType,
  InstanceType,
  MinecraftReactiveEventType,
  MinecraftSendChatPriority
} from '../../common/application-event.js'
import Bridge from '../../common/bridge.js'
import { Status } from '../../common/connectable-instance.js'
import type UnexpectedErrorHandler from '../../common/unexpected-error-handler.js'

import type MessageAssociation from './common/message-association.js'
import type MinecraftInstance from './minecraft-instance.js'

export default class MinecraftBridge extends Bridge<MinecraftInstance> {
  override dispose(): void {
    super.dispose()
  }

  constructor(
    application: Application,
    clientInstance: MinecraftInstance,
    logger: Logger,
    errorHandler: UnexpectedErrorHandler,
    private readonly messageAssociation: MessageAssociation
  ) {
    super(application, clientInstance, logger, errorHandler)
  }

  private shouldProcessEvent(event: { bridgeId?: string }, isStrictChat = false): boolean {
    const instanceBridgeId = this.clientInstance.bridgeId

    if (isStrictChat && (event.bridgeId === undefined || instanceBridgeId === undefined)) return false

    if (event.bridgeId === undefined) return true

    return instanceBridgeId === event.bridgeId
  }

  private disconnectReason: { type: InstanceMessageType; value: string | undefined } | undefined
  private disconnectMessageSent = false

  async onInstance(event: InstanceStatus): Promise<void> {
    if (event.instanceName !== this.clientInstance.instanceName) return
    if (!this.shouldProcessEvent(event)) return

    if (
      event.message !== undefined &&
      event.status !== undefined &&
      (event.status.to === Status.Disconnected || event.status.to === Status.Failed)
    ) {
      this.disconnectReason = { type: event.message.type, value: event.message.value }
      this.disconnectMessageSent = true

      await this.sendDisconnectMessage(event.message.type)
      return
    }

    if (event.status !== undefined && event.status.to === Status.Connected && this.disconnectMessageSent) {
      await this.sendReconnectMessage()
      this.disconnectMessageSent = false
      this.disconnectReason = undefined
      return
    }

    if (
      event.status !== undefined &&
      event.status.to === Status.Failed &&
      event.message === undefined &&
      !this.disconnectMessageSent
    ) {
      await this.clientInstance.send(
        `/gc hi! :3 I've permanently failed. Manual intervention is needed.`,
        MinecraftSendChatPriority.High,
        undefined
      )
    }
  }

  private async sendDisconnectMessage(type: InstanceMessageType): Promise<void> {
    const reason = this.getReasonText(type)
    const blame = this.getBlameText(type)
    await this.clientInstance.send(
      `/gc hi! :3 I disconnected because of ${reason}. ${blame}`,
      MinecraftSendChatPriority.High,
      undefined
    )
  }

  private async sendReconnectMessage(): Promise<void> {
    if (this.disconnectReason === undefined) {
      await this.clientInstance.send(`/gc hi! :3 I reconnected!`, MinecraftSendChatPriority.High, undefined)
      return
    }
    const reason = this.getReasonText(this.disconnectReason.type)
    const blame = this.getBlameText(this.disconnectReason.type)
    await this.clientInstance.send(
      `/gc hi! :3 I reconnected! Previous disconnect was due to ${reason}. ${blame}`,
      MinecraftSendChatPriority.High,
      undefined
    )
  }

  private getReasonText(type: InstanceMessageType): string {
    switch (type) {
      case InstanceMessageType.MinecraftInternetProblems: {
        return 'an internet problem'
      }
      case InstanceMessageType.MinecraftXboxDown: {
        return 'Xbox servers being down'
      }
      case InstanceMessageType.MinecraftXboxThrottled: {
        return 'Xbox throttling requests'
      }
      case InstanceMessageType.MinecraftKicked: {
        return 'getting kicked from the server'
      }
      case InstanceMessageType.MinecraftIncompatible: {
        return 'a version incompatibility'
      }
      case InstanceMessageType.MinecraftBanned: {
        return 'the account being banned'
      }
      case InstanceMessageType.MinecraftNoAccount: {
        return 'the account not owning Minecraft'
      }
      case InstanceMessageType.MinecraftKickedLoggedFromAnotherLocation: {
        return 'someone else logging into the account'
      }
      case InstanceMessageType.MinecraftEnded: {
        return 'the connection ending'
      }
      case InstanceMessageType.MinecraftFailedTooManyTimes: {
        return 'too many connection failures'
      }
      default: {
        return 'an unknown issue'
      }
    }
  }

  private getBlameText(type: InstanceMessageType): string {
    switch (type) {
      case InstanceMessageType.MinecraftNoAccount: {
        return 'Beeny needs to own Minecraft on this account.'
      }
      case InstanceMessageType.MinecraftKickedLoggedFromAnotherLocation: {
        return 'Beeny is logged in elsewhere.'
      }
      default: {
        return "Not beeny's fault."
      }
    }
  }

  async onChat(event: ChatEvent): Promise<void> {
    if (event.instanceName === this.clientInstance.instanceName) return
    if (event.channelType === ChannelType.Private) return
    if (!this.shouldProcessEvent(event, true)) return

    const replyUsername = event.instanceType === InstanceType.Discord ? event.replyUsername : undefined
    const prefix = event.channelType === ChannelType.Public ? 'gc' : 'oc'

    this.messageAssociation.addMessageId(event.eventId, { channel: event.channelType })

    await this.send(
      await this.formatChatMessage(prefix, event.user.displayName(), replyUsername, event.message),
      MinecraftSendChatPriority.Default,
      event.eventId
    ).catch(this.errorHandler.promiseCatch('sending chat message'))
  }

  async onGuildPlayer(event: GuildPlayerEvent): Promise<void> {
    if (event.instanceName === this.clientInstance.instanceName) return
    if (event.type === GuildPlayerEventType.Online || event.type === GuildPlayerEventType.Offline) return
    if (!this.shouldProcessEvent(event, true)) return

    await this.handleInGameEvent(event)
  }

  async onGuildGeneral(event: GuildGeneralEvent): Promise<void> {
    if (event.instanceName === this.clientInstance.instanceName) return
    if (!this.shouldProcessEvent(event, true)) return

    await this.handleInGameEvent(event)
  }

  private readonly lastMinecraftEvent = new Map<MinecraftReactiveEventType, Map<ChannelType, number>>()

  async onMinecraftChatEvent(event: MinecraftReactiveEvent): Promise<void> {
    const reply = this.messageAssociation.getMessageId(event.originEventId)
    if (reply === undefined) return

    let map = this.lastMinecraftEvent.get(event.type)
    if (map === undefined) {
      map = new Map<ChannelType, number>()
      this.lastMinecraftEvent.set(event.type, map)
    }

    if ((map.get(reply.channel) ?? 0) + 5000 > Date.now()) return
    map.set(reply.channel, Date.now())

    this.messageAssociation.addMessageId(event.eventId, reply)
    switch (reply.channel) {
      case ChannelType.Public: {
        if (
          event.type === MinecraftReactiveEventType.RequireGuild &&
          event.instanceName === this.clientInstance.instanceName
        ) {
          return
        }

        await this.send(
          `/gc @[${event.instanceName}]: ${event.message}`,
          MinecraftSendChatPriority.Default,
          event.eventId
        )
        break
      }

      case ChannelType.Officer: {
        if (
          event.type === MinecraftReactiveEventType.RequireGuild &&
          event.instanceName === this.clientInstance.instanceName
        ) {
          return
        }

        await this.send(
          `/oc @[${event.instanceName}]: ${event.message}`,
          MinecraftSendChatPriority.Default,
          event.eventId
        )
        break
      }
      case ChannelType.Private: {
        await this.send(
          `/msg ${reply.username} @[${event.instanceName}]: ${event.message}`,
          MinecraftSendChatPriority.Default,
          event.eventId
        )
      }
    }
  }

  async handleInGameEvent(event: BaseInGameEvent<string>): Promise<void> {
    if (event.channels.includes(ChannelType.Public))
      await this.send(
        `/gc @[${event.instanceName}]: ${event.message}`,
        MinecraftSendChatPriority.Default,
        event.eventId
      )
    else if (event.channels.includes(ChannelType.Officer))
      await this.send(
        `/oc @[${event.instanceName}]: ${event.message}`,
        MinecraftSendChatPriority.Default,
        event.eventId
      )
  }

  async onBroadcast(event: BroadcastEvent): Promise<void> {
    if (!this.shouldProcessEvent(event)) return

    const message = await this.application.minecraftManager.sanitizer.sanitizeChatMessage(
      this.clientInstance.instanceName,
      event.message
    )
    if (event.channels.includes(ChannelType.Public))
      await this.send(`/gc ${message}`, MinecraftSendChatPriority.Default, event.eventId)
    if (event.channels.includes(ChannelType.Officer))
      await this.send(`/oc ${message}`, MinecraftSendChatPriority.Default, event.eventId)
  }

  async onCommand(event: CommandEvent): Promise<void> {
    await this.handleCommand(event, false)
  }

  async onCommandFeedback(event: CommandFeedbackEvent): Promise<void> {
    await this.handleCommand(event, true)
  }

  private async handleCommand(event: CommandEvent, feedback: boolean) {
    if (!this.shouldProcessEvent(event)) return

    const reply = this.messageAssociation.getMessageId(event.originEventId)
    if (reply === undefined) {
      this.logger.error(
        `could not find the reply eventId for eventId ${event.eventId} with origin event id of ${event.originEventId}`
      )
      return
    }

    if (reply.channel === ChannelType.Private) assert.ok(reply.username === event.user.displayName())
    this.messageAssociation.addMessageId(event.eventId, reply)

    const response = `${feedback ? '{f} ' : ''}${event.commandResponse}`
    const sanitizedResponse = await this.application.minecraftManager.sanitizer.sanitizeChatMessage(
      this.clientInstance.instanceName,
      response
    )

    let prefix = ''
    switch (reply.channel) {
      case ChannelType.Public: {
        prefix = '/gc'
        break
      }
      case ChannelType.Officer: {
        prefix = '/oc'
        break
      }
      case ChannelType.Private: {
        if (event.instanceType !== InstanceType.Minecraft || event.instanceName !== this.clientInstance.instanceName)
          return
        prefix = `/msg ${event.user.mojangProfile().name}`
        break
      }
      default: {
        reply satisfies never
        break
      }
    }

    await this.send(`${prefix} ${sanitizedResponse}`, MinecraftSendChatPriority.Default, event.eventId)
  }

  private async send(message: string, priority: MinecraftSendChatPriority, eventId: string | undefined): Promise<void> {
    const newMessage = this.application.minecraftManager.sanitizer.sanitizeGenericCommand(message)
    await this.clientInstance.send(newMessage, priority, eventId)
  }

  private async formatChatMessage(
    prefix: string,
    username: string,
    replyUsername: string | undefined,
    message: string
  ): Promise<string> {
    const template = '{origin}{username}{reply}: {message}'

    const origin = ''

    const sanitizer = this.application.minecraftManager.sanitizer
    username = sanitizer.sanitizeDots(username)
    replyUsername = replyUsername === undefined ? undefined : sanitizer.sanitizeDots(replyUsername)
    const reply = replyUsername === undefined ? '' : `⇾${replyUsername}`

    const templatePrefixLength = template
      .replaceAll('{origin}', origin)
      .replaceAll('{username}', username)
      .replaceAll('{reply}', reply)
      .replaceAll('{message}', '').length

    const maxDescriptionLength = Math.max(256 - prefix.length - 2 - templatePrefixLength - 'sent an image: '.length, 10)

    const sanitizedMessage = await sanitizer.sanitizeChatMessage(this.clientInstance.instanceName, message, {
      maxDescriptionLength
    })

    const formatted = template
      .replaceAll('{origin}', origin)
      .replaceAll('{username}', username)
      .replaceAll('{reply}', reply)
      .replaceAll('{message}', sanitizedMessage)

    return `/${prefix} ${formatted}`
  }
}
