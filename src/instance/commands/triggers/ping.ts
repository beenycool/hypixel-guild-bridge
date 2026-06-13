import type { Player } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'

export default class Ping extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['ping'],
      description: "Returns a player's Hypixel ping (network latency)",
      example: 'ping %s'
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, _player: Player): Promise<string> {
    if (!this.lastPing) {
      return `No ping data available for ${givenUsername}`
    }

    return `[Ping] ${givenUsername}: ${this.lastPing.avg}ms avg | Min: ${this.lastPing.min} | Max: ${this.lastPing.max} | ${this.lastPing.day}`
  }
}
