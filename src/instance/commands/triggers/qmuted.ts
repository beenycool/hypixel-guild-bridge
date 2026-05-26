import { Permission } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class QMuted extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['qmuted'],
      description: 'List users muted from cross-bridge chat (!q)',
      example: `qmuted`
    })
  }

  handler(context: ChatCommandContext): string {
    if (context.message.user.permission() < Permission.Officer) {
      return `${context.username}, you must be Officer or higher to use this command.`
    }

    const mutedUsers = context.app.core.commandsConfigurations.getQMutedUsers()
    const currentTime = Date.now()
    const activeMutes = mutedUsers.filter((entry) => entry.expirationTime > currentTime)

    if (activeMutes.length === 0) {
      return 'No users are currently muted from cross-bridge chat.'
    }

    const muteList = activeMutes.map((entry) => {
      const remainingMinutes = Math.ceil((entry.expirationTime - currentTime) / 60_000)
      return `${entry.username} (${remainingMinutes}m)`
    })

    return `Currently muted from cross-bridge chat: ${muteList.join(', ')}`
  }
}
