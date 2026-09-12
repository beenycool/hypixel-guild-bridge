import { InstanceType } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { Status } from '../../../common/connectable-instance.js'
import { checkChatTriggers, PrivateMessageChat } from '../../../utility/chat-triggers.js'
import { antiSpamString } from '../../../utility/shared-utility'

export default class Boop extends ChatCommandHandler {
  private static readonly CommandCoolDown = 60_000
  private readonly lastCommandExecutionAt = new Map<string, number>()

  constructor() {
    super({
      category: 'Fun',
      triggers: ['boop'],
      description: '/boop a player in-game',
      example: `boop %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const bridgeId = context.message.bridgeId
    if (bridgeId === undefined) {
      return `This command must be used in a configured bridge channel.`
    }

    const currentTime = Date.now()
    const lastCommandExecutionAt = this.lastCommandExecutionAt.get(bridgeId) ?? 0
    if (lastCommandExecutionAt + Boop.CommandCoolDown > currentTime) {
      return `Can use command again in ${Math.floor((lastCommandExecutionAt + Boop.CommandCoolDown - currentTime) / 1000)} seconds.`
    }
    const minecraftInstanceName = this.getActiveMinecraftInstanceName(context, bridgeId)
    if (minecraftInstanceName === undefined) {
      return `No connected Minecraft instance is available for this bridge.`
    }
    this.lastCommandExecutionAt.set(bridgeId, currentTime)

    const result = await checkChatTriggers(
      context.app,
      context.eventHelper,
      PrivateMessageChat,
      [minecraftInstanceName],
      `/boop ${givenUsername} @${antiSpamString()} @${antiSpamString()} @${antiSpamString()} @${antiSpamString()}`,
      givenUsername
    )
    switch (result.status) {
      case 'success': {
        return `${givenUsername} has been booped!`
      }
      case 'failed': {
        return `Can not boop ${givenUsername}: ${result.message.length > 0 ? result.message[0].content : 'No idea why :D'}`
      }
      case 'error': {
        return `Could not boop ${givenUsername} for some unknown reason`
      }
    }
  }

  private getActiveMinecraftInstanceName(context: ChatCommandContext, bridgeId: string): string | undefined {
    const instances = context.app.minecraftManager
      .getAllInstances()
      .filter(
        (instance) =>
          instance.currentStatus() === Status.Connected &&
          context.app.bridgeResolver.getBridgeIdForInstance(instance.instanceName) === bridgeId
      )

    if (context.message.instanceType === InstanceType.Minecraft) {
      const ownInstance = instances.find(
        (instance) => instance.instanceName.toLowerCase() === context.message.instanceName.toLowerCase()
      )
      if (ownInstance !== undefined) return ownInstance.instanceName
    }

    return instances[0]?.instanceName
  }
}
