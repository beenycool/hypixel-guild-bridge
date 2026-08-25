import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

function percentage(): number {
  return Math.floor(Math.random() * 200) + 1
}

export default class Gay extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Fun',
      triggers: ['gay', 'gayness'],
      description: 'Check how gay a player is',
      example: 'gay %s'
    })
  }

  handler(context: ChatCommandContext): string {
    const user1 = context.args[0] ?? context.username
    if (context.args[1]) {
      const user2 = context.args[1]
      return `${user1} and ${user2} are ${percentage()}% gay couple.`
    }
    return `${user1} is ${percentage()}% gay.`
  }
}
