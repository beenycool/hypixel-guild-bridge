import { ChannelType, InstanceType, PunishmentPurpose } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import Duration from '../../../utility/duration'

export default class Kms extends ChatCommandHandler {
  private static readonly TimeLength = Duration.minutes(5)

  constructor() {
    super({
      triggers: ['kms'],
      description: 'mute yourself for 5 minutes',
      example: `kms`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if (context.message.instanceType !== InstanceType.Minecraft || context.message.channelType !== ChannelType.Public) {
      return 'Command can only be executed in-game in guild public channel'
    }

    const user = context.message.user
    await user.mute(
      context.eventHelper.fillBaseEvent(),
      PunishmentPurpose.Game,
      Kms.TimeLength,
      `self-mute via ${context.commandPrefix}${this.triggers[0]}`
    )

    return `${context.username} has muted themselves for 5 minutes.`
  }
}
