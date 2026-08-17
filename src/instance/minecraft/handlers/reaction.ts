import {
  ChannelType,
  Color,
  type GuildPlayerEvent,
  GuildPlayerEventType,
  type InstanceType
} from '../../../common/application-event.js'
import SubInstance from '../../../common/sub-instance'
import type ClientSession from '../client-session.js'
import type MinecraftInstance from '../minecraft-instance.js'

export default class Reaction extends SubInstance<MinecraftInstance, InstanceType.Minecraft, ClientSession> {
  private readonly guildPlayerListener: (event: GuildPlayerEvent) => Promise<void>

  constructor(clientInstance: MinecraftInstance) {
    super(clientInstance)

    this.guildPlayerListener = async (event) => {
      if (
        event.instanceName !== this.clientInstance.instanceName ||
        event.instanceType !== this.clientInstance.instanceType
      )
        return

      const bridgeId = this.application.bridgeResolver.getBridgeIdForInstance(this.clientInstance.instanceName)
      const bridgeConfig = this.application.core.bridgeConfigurations
      const t = this.application.getTranslatorForBridge(bridgeId)

      if (event.type === GuildPlayerEventType.Join && (bridgeId ? bridgeConfig.getJoinGuildReaction(bridgeId) : true)) {
        const raw = t('instance.reaction.join')
        const messages = JSON.parse(raw) as string[]
        if (messages.length === 0) {
          this.logger.error('There is no guild join reaction messages. Dropping the reaction entirely.')
          return
        }
        let message = messages[Math.floor(Math.random() * messages.length)]
        message = message.replaceAll('{username}', event.user.displayName())

        await this.application.emit('broadcast', {
          ...this.eventHelper.fillBaseEvent(),

          channels: [ChannelType.Public],
          color: Color.Good,

          user: event.user,
          message: message
        })
      }

      if (
        event.type === GuildPlayerEventType.Leave &&
        (bridgeId ? bridgeConfig.getLeaveGuildReaction(bridgeId) : true)
      ) {
        const raw = t('instance.reaction.leave')
        const messages = JSON.parse(raw) as string[]
        if (messages.length === 0) {
          this.logger.error('There is no guild leave reaction messages. Dropping the reaction entirely.')
          return
        }
        let message = messages[Math.floor(Math.random() * messages.length)]
        message = message.replaceAll('{username}', event.user.displayName())
        await this.application.emit('broadcast', {
          ...this.eventHelper.fillBaseEvent(),

          channels: [ChannelType.Public],
          color: Color.Bad,

          user: event.user,
          message: message
        })
      }

      if (event.type === GuildPlayerEventType.Kick && (bridgeId ? bridgeConfig.getKickGuildReaction(bridgeId) : true)) {
        const raw = t('instance.reaction.kick')
        const messages = JSON.parse(raw) as string[]
        if (messages.length === 0) {
          this.logger.error('There is no guild kick reaction messages. Dropping the reaction entirely.')
          return
        }
        let message = messages[Math.floor(Math.random() * messages.length)]
        message = message.replaceAll('{username}', event.user.displayName())
        await this.application.emit('broadcast', {
          ...this.eventHelper.fillBaseEvent(),

          channels: [ChannelType.Public],
          color: Color.Bad,

          user: event.user,
          message: message
        })
      }
    }
    this.application.on('guildPlayer', this.guildPlayerListener)
  }

  public override dispose(): void {
    this.application.off('guildPlayer', this.guildPlayerListener)
  }
}
