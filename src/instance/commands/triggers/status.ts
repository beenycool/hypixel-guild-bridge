import type { Status as Session } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatTime } from '../../../utility/shared-utility'
import { getUuidIfExists, usernameNotExists } from '../common/utility'

const withTimeout = async <T>(promise: Promise<T>, ms = 2000): Promise<T | undefined> => {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    promise
      .then((val) => {
        clearTimeout(timer)
        resolve(val)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(undefined)
      })
  })
}

export default class Status extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['status', 'stalk'],
      description: "Show a player's Hypixel status and current location",
      example: `status %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const logger = context.logger
    const startTotal = Date.now()
    const givenUsername = context.args[0] ?? context.username

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) {
      logger.debug(`[status] mojang lookup for "${givenUsername}" took ${Date.now() - startTotal}ms - not found`)
      return usernameNotExists(context, givenUsername)
    }
    logger.debug(`[status] mojang lookup for "${givenUsername}" took ${Date.now() - startTotal}ms`)

    const startParallel = Date.now()
    const [lunarStatus, session, player] = await Promise.all([
      withTimeout(context.app.lunarService.checkLunarStatus(uuid)),
      context.app.hypixelApi.getStatus(uuid, { noCaching: true }).catch(() => undefined) as Promise<Session | undefined>,
      context.app.hypixelApi.getPlayer(uuid).catch(() => undefined) as Promise<{ lastLogoutTimestamp: number } | undefined>
    ])
    logger.debug(
      `[status] parallel checks for ${givenUsername}: ${Date.now() - startParallel}ms (lunar=${lunarStatus})`
    )

    const clientSuffix = lunarStatus === true ? ' and is on Lunar Client' : ''

    if (session?.online) {
      logger.debug(`[status] total for ${givenUsername}: ${Date.now() - startTotal}ms`)
      return this.formatStatus(givenUsername, session, clientSuffix)
    }

    if (player !== undefined) {
      logger.debug(
        `[status] total for ${givenUsername}: ${Date.now() - startTotal}ms (offline, last seen ${formatTime(Date.now() - player.lastLogoutTimestamp)} ago)`
      )
      return `${givenUsername} was last online ${formatTime(Date.now() - player.lastLogoutTimestamp)} ago${clientSuffix}.`
    }

    logger.debug(`[status] total for ${givenUsername}: ${Date.now() - startTotal}ms`)
    return this.formatStatus(givenUsername, session, clientSuffix)
  }

  private formatStatus(username: string, session: Session | undefined, clientSuffix: string): string {
    let result = username

    if (session === undefined) return `${result}'s status is unknown${clientSuffix}.`
    if (!session.online) return `${result}'s status is either hidden or offline${clientSuffix}.`

    if (session.game != undefined) result += ` is playing ${session.game.name}`
    if (session.mode != undefined) result += ` in ${session.mode.toLowerCase()}`
    if (session.map != undefined) result += ` map ${session.map}`

    return `${result}${clientSuffix}.`
  }
}
