import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { formatStatNumber, getUuidIfExists, playerNeverPlayedDungeons, usernameNotExists } from '../common/utility'

export default class Secrets extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['secrets', 's', 'sec'],
      description: 'Returns how many secrets a player has done',
      example: `secrets %s`
    })
  }

  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const uuid = await getUuidIfExists(context.app.mojangApi, username)
    if (uuid == undefined) return usernameNotExists(context, username)

    const hypixelProfile = await context.app.hypixelApi.getPlayer(uuid)
    const dungeon = selectedProfile.dungeons?.dungeon_types
    if (!dungeon) return playerNeverPlayedDungeons(username)

    const catacombRuns = dungeon.catacombs.tier_completions
    const mastermodeRuns = dungeon.master_catacombs.tier_completions

    const totalRuns = this.getTotalRuns(catacombRuns) + this.getTotalRuns(mastermodeRuns)

    const secrets = hypixelProfile.achievements.skyblockTreasureHunter as number
    const averageSecrets = secrets / totalRuns

    return `${username}'s secrets: ${secrets.toLocaleString() || 0} Total ${formatStatNumber(averageSecrets)} Average`
  }

  private getTotalRuns(runs: Record<string, number | undefined> | undefined): number {
    if (runs === undefined) return 0
    return Object.entries(runs)
      .filter(([key]) => key !== 'total')
      .map(([, value]) => value)
      .filter((value) => value !== undefined)
      .reduce((sum, c) => sum + c, 0)
  }
}
