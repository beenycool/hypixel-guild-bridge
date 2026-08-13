import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

import { BridgeSubModeAliases } from './duels-bridge-modes.js'
import Duels from './duels.js'

export default class DuelsBridge extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Minigames',
      triggers: ['b'],
      description:
        "Shortcut for 'duels bridge' (bridge duels stats). Supports sub-modes: 1v1/solo, 2v2/duos, 3v3, 4v4, 2v2v2v2/4teams2, 3v3v3v3/4teams3",
      example: `b [mode] %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const underlying = new Duels()

    const firstArgument = context.args[0]?.toLowerCase()
    const subMode = firstArgument ? BridgeSubModeAliases.get(firstArgument) : undefined

    if (subMode) {
      const newContext = {
        ...context,
        args: ['bridge', subMode, ...context.args.slice(1)]
      } as ChatCommandContext
      return await underlying.handler(newContext)
    }

    const newContext = { ...context, args: ['bridge', ...context.args] } as ChatCommandContext
    return await underlying.handler(newContext)
  }
}
