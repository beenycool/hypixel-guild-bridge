import type { Client } from 'discord.js'
import { DiscordAPIError, Routes } from 'discord.js'

import type Application from '../../../application'
import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler.js'
import type { DiscordMessage } from '../../../core/discord/discord-temporarily-interactions'
import Duration from '../../../utility/duration'
import { setIntervalAsync } from '../../../utility/scheduling'
import { SerialExecutor } from '../../../utility/serial-executor.js'

export default class MessageDeleter {
  private static readonly CheckEvery = Duration.seconds(30)
  private readonly queue = new SerialExecutor()
  private pendingCount = 0

  constructor(
    private readonly application: Application,
    private readonly errorHandler: UnexpectedErrorHandler,
    private readonly client: Client
  ) {
    setIntervalAsync(
      async () => {
        if (this.pendingCount === 0) await this.queueClean()
      },
      { delay: MessageDeleter.CheckEvery, errorHandler: this.errorHandler.promiseCatch('deleting old interactions') }
    )
  }

  public async add(messages: DiscordMessage[]): Promise<void> {
    this.application.core.discordTemporarilyInteractions.add(messages)
    await this.queueClean()
  }

  private async queueClean(): Promise<void> {
    this.pendingCount++
    await this.queue
      .run(() => this.clean())
      .finally(() => {
        this.pendingCount--
      })
  }

  public async clean(): Promise<void> {
    const expiredInteractions = this.application.core.discordTemporarilyInteractions.findToDelete()

    const bulk = new Map<string, string[]>()
    for (const expiredInteraction of expiredInteractions) {
      let messages = bulk.get(expiredInteraction.channelId)
      if (messages === undefined) {
        messages = []
        bulk.set(expiredInteraction.channelId, messages)
      }

      messages.push(expiredInteraction.messageId)
    }

    const tasks = []
    for (const [channelId, messages] of bulk) {
      for (const message of messages) {
        const task = this.deleteMessage(channelId, message)
        tasks.push(task)
      }
    }

    await Promise.allSettled(tasks)

    const messages = expiredInteractions.map((message) => message.messageId)
    this.application.core.discordTemporarilyInteractions.remove(messages)
  }

  private async deleteMessage(channelId: string, messageId: string): Promise<void> {
    try {
      await this.client.rest.delete(Routes.channelMessage(channelId, messageId))
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 10_008) return
      this.errorHandler.promiseCatch(`deleting temporarily event channel=${channelId},message=${messageId}`)(error)
    }
  }
}
