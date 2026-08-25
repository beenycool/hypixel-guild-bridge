import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Cf extends ChatCommandHandler {
    constructor() {
        super({
            category: 'Fun',
            triggers: ['cf'],
            description: 'Flip a coin',
            example: 'cf'
        })
    }

  handler(context: ChatCommandContext): string {
    // 50/50 chance
    const R = Math.random();
    let coin = "";
    if (R > 0.5) {
        coin = "Heads";
    } else {
        coin = "Tails";
    }

    return context.username + ", " + coin + "!";
  }
}