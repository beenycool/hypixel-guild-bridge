import type { SkyblockMember } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { getSelectedSkyblockProfile, playerNeverPlayedSkyblock } from '../utility.js'

import { type SkyblockView } from './types.js'

export const gardenView: SkyblockView = {
  name: 'garden',
  description: "Returns a player's garden stats",
  example: 'sb %s garden',
  needsProfile: false,

  async render(context: ChatCommandContext, username: string, uuid: string): Promise<string> {
    let selectedProfile: SkyblockMember
    try {
      selectedProfile = await getSelectedSkyblockProfile(context.app.hypixelApi, uuid)
    } catch {
      return playerNeverPlayedSkyblock(context, username)
    }

    const garden = selectedProfile.garden
    if (!garden) return `${username} does not have a garden.`

    const crops = garden.cropMilestones
    return (
      `${username}'s Garden ${garden.level.level} | Crop Milestones: ` +
      `Wheat: ${crops.wheat.level} | ` +
      `Carrot: ${crops.carrot.level} | ` +
      `Cane: ${crops.sugarCane.level} | ` +
      `Potato: ${crops.potato.level} | ` +
      `Wart: ${crops.netherWart.level} | ` +
      `Pumpkin: ${crops.pumpkin.level} | ` +
      `Melon: ${crops.melon.level} | ` +
      `Mushroom: ${crops.mushroom.level} | ` +
      `Cocoa: ${crops.cocoaBeans.level} | ` +
      `Cactus: ${crops.cactus.level}`
    )
  }
}
