import NodeCache from 'node-cache'
import type { Logger } from 'log4js'
import Logger4js from 'log4js'

export default class MessageAssociation {
  private readonly messageIds = new NodeCache({ stdTTL: 300 })
  private logger: Logger

  constructor() {
    this.logger = Logger4js.getLogger('MessageAssociation')
  }

  public getMessageId(eventId: string | undefined): DiscordAssociatedMessage[] {
    if (eventId === undefined) return []
    const list: DiscordAssociatedMessage[] = this.messageIds.get(eventId) ?? []
    return [...list]
  }

  public addMessageId(eventId: string, options: DiscordAssociatedMessage): void {
    this.logger.info(
      `[msg-association] add eventId=${eventId} channelId=${options.channelId} guildId=${options.guildId}`
    )
    let list: DiscordAssociatedMessage[] | undefined = this.messageIds.get(eventId)
    list ??= []

    list = list.filter((item) => item.channelId !== options.channelId)
    list.push(options)

    this.messageIds.set(eventId, list)
  }
}

export interface DiscordAssociatedMessage {
  guildId: string | undefined
  channelId: string
  messageId: string
}
