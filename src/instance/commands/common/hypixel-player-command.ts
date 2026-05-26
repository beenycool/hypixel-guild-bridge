import type { Player } from 'hypixel-api-reborn'

import { type ChatCommandContext, ChatCommandHandler } from '../../../common/commands.js'

import { getUuidIfExists, playerNeverPlayedHypixel, usernameNotExists } from './utility'

function classifyHypixelError(error: unknown): string | undefined {
  const status = (error as { response?: { status?: number } })?.response?.status
  if (status === 429) return 'The Hypixel API is currently rate-limiting. Please try again later.'
  if (status === 403) return 'The Hypixel API key is invalid. Please check your API key.'
  if (status != undefined && status >= 500) return 'The Hypixel API is currently down. Please try again later.'
  const code = (error as { code?: string })?.code
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND')
    return 'The Hypixel API is currently down. Please try again later.'
  return undefined
}

export abstract class HypixelPlayerCommand extends ChatCommandHandler {
  protected resolveUsername(context: ChatCommandContext): string {
    return context.args[0] ?? context.username
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = this.resolveUsername(context)
    context.logger.debug(
      `hypixel-player-command start command=${this.triggers[0]} username=${givenUsername} args=${JSON.stringify(context.args)}`
    )

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    context.logger.debug(
      `hypixel-player-command mojang lookup command=${this.triggers[0]} username=${givenUsername} result=${String(uuid)}`
    )
    if (uuid == undefined) {
      context.logger.debug(
        `hypixel-player-command username missing command=${this.triggers[0]} username=${givenUsername}`
      )
      return usernameNotExists(context, givenUsername)
    }

    try {
      context.logger.debug(
        `hypixel-player-command hypixel lookup command=${this.triggers[0]} username=${givenUsername} uuid=${uuid}`
      )
      const player = await context.app.hypixelApi.getPlayer(uuid, {})
      context.logger.debug(
        `hypixel-player-command hypixel lookup success command=${this.triggers[0]} username=${givenUsername} uuid=${uuid} player=${player.nickname}`
      )
      return this.onPlayer(context, givenUsername, player)
    } catch (error: unknown) {
      context.logger.debug(
        `hypixel-player-command hypixel lookup failed command=${this.triggers[0]} username=${givenUsername} error=${
          error instanceof Error ? error.message : String(error)
        }`
      )
      const message = classifyHypixelError(error)
      if (message != undefined) {
        context.logger.debug(
          `hypixel-player-command classified hypixel error command=${this.triggers[0]} username=${givenUsername} message=${message}`
        )
        return message
      }

      context.logger.debug(
        `hypixel-player-command falling back to never-played command=${this.triggers[0]} username=${givenUsername}`
      )
      return playerNeverPlayedHypixel(context, givenUsername)
    }
  }

  abstract onPlayer(context: ChatCommandContext, username: string, player: Player): Promise<string>
}
