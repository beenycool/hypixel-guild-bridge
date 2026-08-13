import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Chattermute extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Utility',
      triggers: ['chattermute'],
      description: 'Pause random chatter until you log out or run this command again',
      example: 'chattermute'
    })
  }

  handler(context: ChatCommandContext): string {
    const chatter = context.app.randomChatter
    const pausedBy = chatter.pausedBy

    if (pausedBy === undefined) {
      chatter.pausedBy = context.username
      return `${context.username}, random chatter has been paused. It will resume when you log out or run !chattermute again.`
    }

    if (pausedBy.toLowerCase() === context.username.toLowerCase()) {
      chatter.pausedBy = undefined
      return `${context.username}, random chatter has been resumed.`
    }

    return `${context.username}, random chatter is already paused by ${pausedBy}.`
  }
}
