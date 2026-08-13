import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'

export default class HypixelLevel extends HypixelPlayerCommand {
  constructor() {
    super({
      category: 'Player',
      triggers: ['hlevel', 'hypixellevel', 'hlvl'],
      description: "Returns a player's Hypixel common stats",
      example: `hlevel %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onPlayer(context: ChatCommandContext, givenUsername: string, player: Player): Promise<string> {
    return `${givenUsername} is Hypixel level ${player.level}.` + this.formatPingSuffix()
  }
}
