import type { Status as Session } from 'hypixel-api-reborn'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatTime } from '../../../utility/shared-utility'
import { getUuidIfExists, usernameNotExists } from '../common/utility'

const withTimeout = async <T>(promise: Promise<T>, ms = 2000): Promise<T | undefined> => {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => {
      resolve(undefined)
    }, ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
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
      category: 'Player',
      triggers: ['status', 'stalk'],
      description: "Show a player's Hypixel status and current location",
      example: `status %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) {
      return usernameNotExists(context, givenUsername)
    }

    const [lunarStatus, session, player] = await Promise.all([
      withTimeout(context.app.lunarService.checkLunarStatus(uuid)),
      context.app.hypixelApi.getStatus(uuid, { noCaching: true }).catch(() => undefined),
      context.app.hypixelApi.getPlayer(uuid).catch(() => undefined) as Promise<
        { lastLogoutTimestamp: number } | undefined
      >
    ])

    if (session?.online) {
      const suffix = lunarStatus === true ? ' and is on Lunar Client' : ''
      return this.formatStatus(givenUsername, session, suffix)
    }

    if (player !== undefined) {
      const lastSeen = formatTime(Date.now() - player.lastLogoutTimestamp)
      if (lunarStatus === true) {
        return `${givenUsername} is currently online with Lunar Client on another server (last seen on Hypixel ${lastSeen} ago).`
      }
      return `${givenUsername} was last online ${lastSeen} ago.`
    }

    if (lunarStatus === true) {
      return `${givenUsername} is currently online with Lunar Client on another server.`
    }
    return this.formatStatus(givenUsername, session, '')
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
