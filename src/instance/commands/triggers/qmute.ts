import { Permission } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class QMute extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Moderation',
      triggers: ['qm'],
      description: 'Mute a user from using cross-bridge chat (!chat)',
      example: `qm aidn5 30`
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
    const durationArgument = context.args[1] ?? '30'
    const durationMinutes = Number.parseInt(durationArgument, 10)

    if (Number.isNaN(durationMinutes) || durationMinutes <= 0) {
      return `${context.username}, invalid duration. Please use a number of minutes.`
    }

    const expirationTime = Date.now() + durationMinutes * 60 * 1000
    context.app.core.commandsConfigurations.addQMutedUser(targetUsername, expirationTime)

    return `${targetUsername} has been muted from cross-bridge chat for ${durationMinutes} minute(s).`
  }
}
