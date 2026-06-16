import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Racism extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['racism'],
      description: 'Check how racist a player is',
      example: `racism %s`
    })
  }

  handler(context: ChatCommandContext): string {
    const givenUsername = context.args[0] ?? context.username
    const percentage = Math.floor(Math.random() * 200) + 1
    return `${givenUsername} is ${percentage}% racist. Racism is not allowed!`
  }
}
