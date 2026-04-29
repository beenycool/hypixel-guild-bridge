import type { Player } from 'hypixel-api-reborn'

import { type ChatCommandContext, ChatCommandHandler } from '../../../common/commands.js'

import { getUuidIfExists, playerNeverPlayedHypixel, usernameNotExists } from './utility'

export abstract class HypixelPlayerCommand extends ChatCommandHandler {
  protected resolveUsername(context: ChatCommandContext): string {
    return context.args[0] ?? context.username
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = this.resolveUsername(context)

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    const player = await context.app.hypixelApi.getPlayer(uuid, {}).catch(() => undefined)
    if (player == undefined) return playerNeverPlayedHypixel(context, givenUsername)

    return this.onPlayer(context, givenUsername, player)
  }

  abstract onPlayer(context: ChatCommandContext, username: string, player: Player): Promise<string>
}
