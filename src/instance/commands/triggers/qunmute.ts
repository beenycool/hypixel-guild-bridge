import { Permission } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class QUnmute extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Moderation',
      triggers: ['qunmute'],
      description: 'Unmute a user from using cross-bridge chat (!chat)',
      example: `qunmute aidn5`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if ((await context.message.user.permission()) < Permission.Officer) {
      return `${context.username}, you must be Officer or higher to use this command.`
    }

    if (context.args.length === 0) {
      return this.getExample(context.commandPrefix)
    }

    const targetUsername = context.args[0]
    context.app.core.commandsConfigurations.removeQMutedUser(targetUsername)

    return `${targetUsername} has been unmuted from cross-bridge chat.`
  }
}
