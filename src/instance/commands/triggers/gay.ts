import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Gay extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['gay', 'gayness'],
      description: 'Check how gay a player is',
      example: 'gay %s'
    })
  }

  handler(context: ChatCommandContext): string {
    const givenUsername = context.args[0] ?? context.username
    const percentage = Math.floor(Math.random() * 200) + 1
    return `${givenUsername} is ${percentage}% gay.`
  }
}
