import type { ChatCommandContext } from '../../../../common/commands.js'
import { getSelectedSkyblockProfile } from '../utility.js'

import { type SkyblockView } from './types.js'

export const hotmView: SkyblockView = {
  name: 'hotm',
  description: "Returns a player's hotm and powder",
  example: 'sb %s hotm',
  needsProfile: false,

  async render(context: ChatCommandContext, username: string, uuid: string): Promise<string> {
    const selectedProfile = await getSelectedSkyblockProfile(context.app.hypixelApi, uuid)
    const hotm = selectedProfile.hotm

    let response = `${username} is HOTM ${hotm.experience.level}`

    const powders: string[] = []
    if (hotm.powder.mithril.total > 0)
      powders.push(`${(hotm.powder.mithril.current + hotm.powder.mithril.spent).toLocaleString('en-US')} Mithril`)
    if (hotm.powder.gemstone.total > 0)
      powders.push(`${(hotm.powder.gemstone.current + hotm.powder.gemstone.spent).toLocaleString('en-US')} Gemstone`)
    if (hotm.powder.glacite.total > 0)
      powders.push(`${(hotm.powder.glacite.current + hotm.powder.glacite.spent).toLocaleString('en-US')} Glacite`)
    if (powders.length > 0) response += ` with powders (${powders.join(' - ')})`

    return response
  }
}
