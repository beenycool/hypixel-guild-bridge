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

      if (event.type === GuildPlayerEventType.Join && (bridgeId ? bridgeConfig.getJoinGuildReaction(bridgeId) : true)) {
        const messages = this.resolveReactionMessages(bridgeId, 'instance.reaction.join')
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
        const messages = this.resolveReactionMessages(bridgeId, 'instance.reaction.leave')
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
        const messages = this.resolveReactionMessages(bridgeId, 'instance.reaction.kick')
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

  private resolveReactionMessages(bridgeId: string | undefined, key: string): string[] {
    const t = this.application.getTranslatorForBridge(bridgeId)
    // i18next returns the raw array resource when returnObjects is set while an
    // override set via /settings is a plain string that may contain JSON.
    const raw = t(key, { returnObjects: true })

    if (Array.isArray(raw)) {
      return raw as string[]
    }
    if (raw.length === 0 || raw === key) {
      return []
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as string[]) : [raw]
    } catch {
      return [raw]
    }
  }

  public override dispose(): void {
    this.application.off('guildPlayer', this.guildPlayerListener)
  }
}
