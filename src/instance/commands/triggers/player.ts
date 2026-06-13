import type { Player as HypixelPlayer } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { formatNumber } from '../../../common/helper-functions.js'
import { HypixelPlayerCommand } from '../common/hypixel-player-command.js'

export default class Player extends HypixelPlayerCommand {
  constructor() {
    super({
      triggers: ['player', 'general'],
      description: 'Get Hypixel player stats.',
      example: `player %s`
    })
  }

  async onPlayer(context: ChatCommandContext, givenUsername: string, player: HypixelPlayer): Promise<string> {
    const guild = await context.app.hypixelApi.getGuild('player', player.uuid).catch(() => undefined)
    const guildName = guild?.name ?? 'None'

    const rank = player.rank
    const rankPrefix = ['default', 'none'].includes(rank.toLowerCase()) ? '' : `[${rank}] `

    const level = formatNumber(player.level, 2)
    const karma = formatNumber(player.karma, 0)
    const achievementPoints = formatNumber(player.achievementPoints, 0)

    return (
      `${rankPrefix}${player.nickname}'s level: ${level} | ` +
      `Karma: ${karma} | ` +
      `Achievement Points: ${achievementPoints} | ` +
      `Guild: ${guildName}` +
      this.formatPingSuffix()
    )
  }
}
