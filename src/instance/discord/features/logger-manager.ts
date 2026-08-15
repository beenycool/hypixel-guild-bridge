import type { Client } from 'discord.js'
import { escapeMarkdown } from 'discord.js'

import type { InstanceType } from '../../../common/application-event.js'
import { GuildPlayerEventType } from '../../../common/application-event.js'
import { Status } from '../../../common/connectable-instance.js'
import SubInstance from '../../../common/sub-instance'
import type DiscordInstance from '../discord-instance.js'

export default class LoggerManager extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  constructor(clientInstance: DiscordInstance) {
    super(clientInstance)

    this.application.on('guildPlayer', async (event) => {
      if (event.type == GuildPlayerEventType.Online || event.type == GuildPlayerEventType.Offline) return

      const bridgeId = event.bridgeId ?? this.application.bridgeResolver.getBridgeIdForInstance(event.instanceName)
      if (bridgeId === undefined) return

      await this.send(`Guild > ${event.instanceName}: ${event.message}`, bridgeId).catch(
        this.errorHandler.promiseCatch('handling guildPlayer event')
      )
    })
  }

  private async send(message: string, bridgeId: string): Promise<void> {
    const currentStatus = this.clientInstance.currentStatus()
    if (currentStatus === Status.Ended) return

    const channels = this.application.core.bridgeConfigurations.getLoggerChannelIds(bridgeId)
    const client = this.clientInstance.getClient()

    for (const channelId of channels) {
      try {
        const channel = await client.channels.fetch(channelId)
        if (!channel?.isSendable()) continue
        await channel.send({ content: escapeMarkdown(message), allowedMentions: { parse: [] } })
      } catch (error: unknown) {
        this.logger.error(error)
      }
    }
  }
}
