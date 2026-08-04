import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { formatNumber } from '../../../common/helper-functions.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'
import { playerNeverEnteredCrimson } from '../common/utility'

type DojoData = Record<string, number | undefined>

export default class Dojo extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['dojo'],
      description: "Returns a player's dojo stats",
      example: `dojo %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    if (!selectedProfile.nether_island_player_data) return playerNeverEnteredCrimson(username)

    const dojo = (selectedProfile.nether_island_player_data as { dojo?: DojoData }).dojo ?? {}
    let totalPoints = 0
    for (const [key, value] of Object.entries(dojo)) {
      if (key.startsWith('dojo_points') && value !== undefined) {
        totalPoints += value
      }
    }

    const belt = Dojo.getBelt(totalPoints)
    const force = dojo.dojo_points_mob_kb ?? 0
    const stamina = dojo.dojo_points_wall_jump ?? 0
    const mastery = dojo.dojo_points_archer ?? 0
    const discipline = dojo.dojo_points_sword_swap ?? 0
    const swiftness = dojo.dojo_points_snake ?? 0
    const control = dojo.dojo_points_lock_head ?? 0
    const tenacity = dojo.dojo_points_fireball ?? 0

    return (
      `${username}'s Belt: ${belt} | ` +
      `Best Force: ${formatNumber(force)} | ` +
      `Best Stamina: ${formatNumber(stamina)} | ` +
      `Best Mastery: ${formatNumber(mastery)} | ` +
      `Best Discipline: ${formatNumber(discipline)} | ` +
      `Best Swiftness: ${formatNumber(swiftness)} | ` +
      `Best Control: ${formatNumber(control)} | ` +
      `Best Tenacity: ${formatNumber(tenacity)}`
    )
  }

  private static getBelt(points: number): string {
    if (points >= 7000) return 'Black'
    if (points >= 6000) return 'Brown'
    if (points >= 4000) return 'Blue'
    if (points >= 2000) return 'Green'
    if (points >= 1000) return 'Yellow'
    return 'White'
  }
}
