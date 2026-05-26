import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { playerNeverPlayedDungeons } from '../common/utility'

export default class Runs extends SkyblockPlayerCommand {
  protected override resolveUsername(context: ChatCommandContext): string {
    return context.args[1] ?? context.username
  }

  constructor() {
    super({
      triggers: ['runs', 'r'],
      description: 'Returns how many dungeon runs a player has done',
      example: `runs mm %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const givenType = context.args[0]?.toLowerCase() ?? 'cata'

    let masterMode = false
    if (givenType == 'cata' || givenType === 'catacombs') {
      masterMode = false
    } else if (givenType === 'mm' || givenType === 'mastermode') {
      masterMode = true
    } else {
      return `${context.username}, invalid type. can be 'cata'/'mm' but not '${givenType}'`
    }

    const dungeon = selectedProfile.dungeons?.dungeon_types
    if (!dungeon) {
      return playerNeverPlayedDungeons(username)
    }

    const runs = masterMode
      ? this.getTotalRuns(dungeon.master_catacombs.tier_completions)
      : this.getTotalRuns(dungeon.catacombs.tier_completions)
    if (runs.length === 0) return `${username}: ${givenType} - never done runs in this type before?`

    return `${username}: ${givenType} - ${runs.join('/')}`
  }

  private getTotalRuns(runs: Record<string, number | undefined> | undefined): number[] {
    if (runs === undefined) return []
    return Object.entries(runs)
      .filter(([key]) => key !== 'total')
      .map(([, value]) => value)
      .filter((value) => value !== undefined)
  }
}
