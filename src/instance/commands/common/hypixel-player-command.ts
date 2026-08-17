import type { Player } from 'hypixel-api-reborn'

import { type ChatCommandContext, ChatCommandHandler } from '../../../common/commands.js'

import { fetchAuroraPing, getUuidIfExists, playerNeverPlayedHypixel, usernameNotExists } from './utility'
import type { AuroraPingEntry } from './utility'

function classifyHypixelError(error: unknown): string | undefined {
  const status = (error as { response?: { status?: number } }).response?.status
  if (status === 429) return 'The Hypixel API is currently rate-limiting. Please try again later.'
  if (status === 403) return 'The Hypixel API key is invalid. Please check your API key.'
  if (status != undefined && status >= 500) return 'The Hypixel API is currently down. Please try again later.'
  const code = (error as { code?: string }).code
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND')
    return 'The Hypixel API is currently down. Please try again later.'
  return undefined
}

export abstract class HypixelPlayerCommand extends ChatCommandHandler {
  protected lastPing: AuroraPingEntry | undefined
  protected lastUuid: string | undefined

  protected resolveUsername(context: ChatCommandContext): string {
    return context.args[0] ?? context.username
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = this.resolveUsername(context)

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) {
      return usernameNotExists(context, givenUsername)
    }

    this.lastUuid = uuid
    this.lastPing = await fetchAuroraPing(uuid, context.app.auroraApiKey ?? '')

    try {
      const player = await context.app.hypixelApi.getPlayer(uuid, {})
      return await this.onPlayer(context, givenUsername, player)
    } catch (error: unknown) {
      const message = classifyHypixelError(error)
      if (message != undefined) {
        return message
      }

      return playerNeverPlayedHypixel(context, givenUsername)
    }
  }

  protected formatPingSuffix(): string {
    if (!this.lastPing) return ''
    return ` Ping: ${this.lastPing.avg} (${this.lastPing.min}-${this.lastPing.max})`
  }

  abstract onPlayer(context: ChatCommandContext, username: string, player: Player): Promise<string>
}
