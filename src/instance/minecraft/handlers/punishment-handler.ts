import type { GuildPlayerEvent, GuildPlayerResponsible, InstanceType } from '../../../common/application-event.js'
import {
  ChannelType,
  Color,
  GuildPlayerEventType,
  MinecraftSendChatPriority
} from '../../../common/application-event.js'
import SubInstance from '../../../common/sub-instance'
import { HeatResult, HeatType } from '../../../core/moderation/commands-heat'
import type ClientSession from '../client-session.js'
import type MinecraftInstance from '../minecraft-instance.js'

export default class PunishmentHandler extends SubInstance<MinecraftInstance, InstanceType.Minecraft, ClientSession> {
  private readonly guildPlayerListener: (event: GuildPlayerEvent) => Promise<void>

  constructor(clientInstance: MinecraftInstance) {
    super(clientInstance)
    this.guildPlayerListener = async (event) => {
      if (
        event.instanceName !== this.clientInstance.instanceName ||
        event.instanceType !== this.clientInstance.instanceType
      )
        return

      await this.onGuildPlayer(event).catch(this.errorHandler.promiseCatch('handling guildPlayer event'))
    }
    this.application.on('guildPlayer', this.guildPlayerListener)
  }

  public override dispose(): void {
    this.application.off('guildPlayer', this.guildPlayerListener)
  }

  private async onGuildPlayer(event: GuildPlayerEvent): Promise<void> {
    switch (event.type) {
      case GuildPlayerEventType.Mute:
      case GuildPlayerEventType.Unmute: {
        await this.checkHeat(event, HeatType.Mute)
        break
      }
      case GuildPlayerEventType.Kick: {
        await this.checkHeat(event, HeatType.Kick)
      }
    }
  }

  private async checkHeat(event: GuildPlayerResponsible, heatType: HeatType): Promise<void> {
    const mojangProfile = event.responsible.mojangProfile()
    const username = mojangProfile.name
    const uuid = mojangProfile.id

    if (
      this.application.minecraftManager.isMinecraftBot(username) ||
      this.application.minecraftManager.isMinecraftBot(uuid)
    )
      return

    const bridgeId = this.clientInstance.bridgeId
    if (!this.application.core.isHeatPunishmentEnabled(bridgeId)) {
      return
    }

    const heatResult = await event.responsible.addModerationAction(heatType)

    if (heatResult === HeatResult.Warn) {
      await this.application.emit('broadcast', {
        ...this.eventHelper.fillBaseEvent(),
        channels: [ChannelType.Public, ChannelType.Officer],
        color: Color.Info,

        user: event.responsible,
        message: this.application.getTranslatorForBridge(this.clientInstance.bridgeId)('instance.heat.warn', {
          username
        })
      })
    } else if (heatResult === HeatResult.Denied) {
      await this.application.emit('broadcast', {
        ...this.eventHelper.fillBaseEvent(),
        channels: [ChannelType.Public, ChannelType.Officer],
        color: Color.Bad,

        user: event.responsible,
        message: this.application.getTranslatorForBridge(this.clientInstance.bridgeId)('instance.heat.denied', {
          username
        })
      })

      await this.clientInstance.send(`/g demote ${uuid}`, MinecraftSendChatPriority.High, undefined)
    }
  }
}
