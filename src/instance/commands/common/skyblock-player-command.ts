import type { SkyblockV2Member } from 'hypixel-api-reborn'

import { type ChatCommandContext, ChatCommandHandler } from '../../../common/commands.js'

import { getSelectedSkyblockProfileRaw, getUuidIfExists, playerNeverPlayedSkyblock, usernameNotExists } from './utility'

export abstract class SkyblockPlayerCommand extends ChatCommandHandler {
  protected resolveUsername(context: ChatCommandContext): string {
    return context.args[0] ?? context.username
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = this.resolveUsername(context)

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    const selectedProfile = await getSelectedSkyblockProfileRaw(context.app.hypixelApi, uuid)
    if (!selectedProfile) return playerNeverPlayedSkyblock(context, givenUsername)

    return this.onSkyblockPlayer(context, givenUsername, selectedProfile)
  }

  abstract onSkyblockPlayer(
    context: ChatCommandContext,
    username: string,
    selectedProfile: SkyblockV2Member
  ): Promise<string>
}
