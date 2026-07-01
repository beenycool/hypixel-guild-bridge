import type { ChatEvent, InstanceType } from '../../../common/application-event.js'
import { ChannelType, Color } from '../../../common/application-event.js'
import SubInstance from '../../../common/sub-instance'
import type ClientSession from '../client-session.js'
import type MinecraftInstance from '../minecraft-instance.js'

export default class PlayerMuted extends SubInstance<MinecraftInstance, InstanceType.Minecraft, ClientSession> {
  public static readonly DefaultMessage = '{username} is currently muted and is unable to message right now.'

  private readonly chatListener: (event: ChatEvent) => Promise<void>

  constructor(clientInstance: MinecraftInstance) {
    super(clientInstance)
    this.chatListener = async (event) => {
      if (
        event.instanceName !== this.clientInstance.instanceName ||
        event.instanceType !== this.clientInstance.instanceType
      )
        return

      const bridgeId = this.application.bridgeResolver.getBridgeIdForInstance(this.clientInstance.instanceName)
      const bridgeConfig = this.application.core.bridgeConfigurations

      const enabled = bridgeId
        ? bridgeConfig.getAnnounceMutedPlayer(bridgeId)
        : this.application.core.minecraftConfigurations.getAnnounceMutedPlayer()
      if (!enabled) return

      if (!event.message.startsWith("Hey! I'm currently muted")) return
      if (!event.rawMessage.includes('§eHey!')) return

      let message = bridgeId
        ? bridgeConfig.getAnnounceMutedPlayerMessage(
            bridgeId,
            this.application.core.languageConfigurations.getAnnounceMutedPlayer()
          )
        : this.application.core.languageConfigurations.getAnnounceMutedPlayer()
      message = message.replaceAll('{username}', event.user.displayName())

      await this.application.emit('broadcast', {
        ...this.eventHelper.fillBaseEvent(),

        channels: [ChannelType.Public],
        color: Color.Default,

        user: event.user,
        message: message
      })
    }
    this.application.on('chat', this.chatListener)
  }

  public override dispose(): void {
    this.application.off('chat', this.chatListener)
  }
}
