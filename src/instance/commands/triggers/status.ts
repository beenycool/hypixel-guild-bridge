import type { Status as Session } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatTime } from '../../../utility/shared-utility'
import { getUuidIfExists, usernameNotExists } from '../common/utility'

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

    const startMojang = Date.now()
    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) {
      logger.debug(`[status] mojang lookup for "${givenUsername}" took ${Date.now() - startMojang}ms - not found`)
      return usernameNotExists(context, givenUsername)
    }
    logger.debug(`[status] mojang lookup for "${givenUsername}" -> ${uuid} took ${Date.now() - startMojang}ms`)

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

    const startClients = Date.now()
    const [lunarStatus, featherStatus, essentialStatus] = await Promise.all([
      withTimeout(context.app.lunarService.checkLunarStatus(uuid)),
      withTimeout(context.app.featherService.checkFeatherStatus(uuid)),
      withTimeout(context.app.essentialService.checkEssentialStatus(uuid))
    ])
    logger.debug(
      `[status] client checks for ${givenUsername} took ${Date.now() - startClients}ms (lunar=${lunarStatus}, feather=${featherStatus}, essential=${essentialStatus})`
    )

    const activeClients: string[] = []
    if (lunarStatus === true) activeClients.push('Lunar Client')
    if (featherStatus === true) activeClients.push('Feather Client')
    if (essentialStatus === true) activeClients.push('Essential Client')

    let clientSuffix = ''
    if (activeClients.length > 0) {
      const clientText =
        activeClients.length === 1
          ? activeClients[0]
          : activeClients.slice(0, -1).join(', ') + ' and ' + (activeClients.at(-1) ?? '')
      clientSuffix = ` and is on ${clientText}`
    }

    const startStatus = Date.now()
    const session = await context.app.hypixelApi.getStatus(uuid, { noCaching: true }).catch(() => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      return undefined
    })
    logger.debug(`[status] hypixel getStatus for ${givenUsername} took ${Date.now() - startStatus}ms (online=${session?.online ?? 'error'})`)

    if (!session?.online) {
      const startPlayer = Date.now()
      const player = await context.app.hypixelApi.getPlayer(uuid).catch(() => undefined)
      logger.debug(`[status] hypixel getPlayer for ${givenUsername} took ${Date.now() - startPlayer}ms (found=${player !== undefined})`)
      if (player !== undefined) {
        logger.debug(`[status] total for ${givenUsername}: ${Date.now() - startTotal}ms (offline, last seen ${formatTime(Date.now() - player.lastLogoutTimestamp)} ago)`)
        return `${givenUsername} was last online ${formatTime(Date.now() - player.lastLogoutTimestamp)} ago${clientSuffix}.`
      }
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
