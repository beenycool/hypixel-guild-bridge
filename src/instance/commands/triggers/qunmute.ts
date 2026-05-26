import { Permission } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class QUnmute extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['qunmute'],
      description: 'Unmute a user from using cross-bridge chat (!q)',
      example: `qunmute aidn5`
    })
  }

  handler(context: ChatCommandContext): string {
    if (context.message.user.permission() < Permission.Officer) {
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
