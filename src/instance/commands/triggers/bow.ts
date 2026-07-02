import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

import Duels from './duels.js'

export default class Bow extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['bow'],
      description: "Shortcut for 'duels bow' (bow duels stats)",
      example: `bow %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const underlying = new Duels()

    const newContext = { ...context, args: ['bow', ...context.args] } as ChatCommandContext

    return await underlying.handler(newContext)
  }
}
