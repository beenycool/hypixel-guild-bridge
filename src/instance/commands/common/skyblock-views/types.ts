import type { SkyblockV2Member, SkyblockV2Profile } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../../common/commands.js'

export interface SelectedSkyblockProfile {
  readonly profile: SkyblockV2Profile
  readonly member: SkyblockV2Member
}

export interface SkyblockView {
  readonly name: string
  readonly description: string
  readonly example: string
  readonly needsProfile: boolean
  render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined,
    argumentValues: string[]
  ): Promise<string>
}
