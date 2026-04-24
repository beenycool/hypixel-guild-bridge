import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

import Duels from './duels.js'

export default class DuelsBridge extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['b'],
      description: "Shortcut for 'duels bridge' (bridge duels stats)",
      example: `b %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const underlying = new Duels()

    // prefix args with 'bridge' so the Duels handler processes it as `duels bridge [username]`
    const newContext: ChatCommandContext = { ...context, args: ['bridge', ...context.args] }
    return await underlying.handler(newContext)
  }
}
