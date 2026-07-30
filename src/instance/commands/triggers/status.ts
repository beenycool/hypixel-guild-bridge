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
    const givenUsername = context.args[0] ?? context.username

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

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

    const [lunarStatus, featherStatus, essentialStatus] = await Promise.all([
      withTimeout(context.app.lunarService.checkLunarStatus(uuid)),
      withTimeout(context.app.featherService.checkFeatherStatus(uuid)),
      withTimeout(context.app.essentialService.checkEssentialStatus(uuid))
    ])

    let clientTags = ''
    if (lunarStatus === true) {
      clientTags += ' [Lunar: Online 🌙]'
    } else if (lunarStatus === false) {
      clientTags += ' [Lunar: Offline]'
    }

    if (featherStatus === true) {
      clientTags += ' [Feather: Online 🪶]'
    } else if (featherStatus === false) {
      clientTags += ' [Feather: Offline]'
    }

    if (essentialStatus === true) {
      clientTags += ' [Essential: Online ✨]'
    } else if (essentialStatus === false) {
      clientTags += ' [Essential: Offline]'
    }

    const session = await context.app.hypixelApi.getStatus(uuid, { noCaching: true }).catch(() => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      return undefined
    })
    if (!session?.online) {
      const player = await context.app.hypixelApi.getPlayer(uuid).catch(() => undefined)
      if (player !== undefined) {
        return `${givenUsername} was last online ${formatTime(Date.now() - player.lastLogoutTimestamp)} ago.${clientTags}`
      }
    }

    return this.formatStatus(givenUsername, session) + clientTags
  }

  private formatStatus(username: string, session: Session | undefined): string {
    let result = username

    if (session === undefined) return result + "'s status is unknown"
    if (!session.online) return result + "'s status is either hidden or offline"

    if (session.game != undefined) result += ` is playing ${session.game.name}`
    if (session.mode != undefined) result += ` in ${session.mode.toLowerCase()}`
    if (session.map != undefined) result += ` map ${session.map}`

    return result
  }
}
