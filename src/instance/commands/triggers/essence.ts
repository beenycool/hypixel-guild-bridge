import type { SkyblockV2Member } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { SkyblockPlayerCommand } from '../common/skyblock-player-command.js'

export default class Essence extends SkyblockPlayerCommand {
  constructor() {
    super({
      triggers: ['essence', 'ess'],
      description: "Returns a player's essence perks",
      example: `essence %s`
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- base class contract requires Promise<string>
  async onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string> {
    const essencePerks = selectedProfile.essence?.perks
    if (!essencePerks) return `${username} has no essence perks.`

    const perks: string[] = []
    if (essencePerks.cold_efficiency) perks.push(`Cold Eff: ${essencePerks.cold_efficiency}`)
    if (essencePerks.heart_of_gold) perks.push(`Heart Gold: ${essencePerks.heart_of_gold}`)
    if (essencePerks.diamond_in_the_rough) perks.push(`Diamond: ${essencePerks.diamond_in_the_rough}`)
    if (essencePerks.toxophilite) perks.push(`Toxophilite: ${essencePerks.toxophilite}`)
    if (essencePerks.unbridled_rage) perks.push(`Rage: ${essencePerks.unbridled_rage}`)

    if (perks.length === 0) return `${username} has no essence perks unlocked.`

    return `${username}'s Essence Perks: ${perks.join(' | ')}`
  }
}
