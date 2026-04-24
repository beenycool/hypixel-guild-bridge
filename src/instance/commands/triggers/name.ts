import DefaultAxios from 'axios'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { getUuidIfExists, usernameNotExists } from '../common/utility.js'

export default class NameHistory extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['name', 'names', 'history', 'namehistory'],
      description: "Get a player's name history.",
      example: 'name %s'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid === undefined) return usernameNotExists(context, givenUsername)

    try {
      const response = await DefaultAxios.get<AshconResponse>(`https://api.ashcon.app/mojang/v2/user/${uuid}`)
      const history = (response.data as unknown as Record<string, unknown>).username_history as {
        username: string
      }[]

      if (history.length === 0) {
        return context.app.i18n.t(($) => $['commands.name.no-history'], { username: givenUsername })
      }

      const names = history
        .map((entry) => entry.username)
        .toReversed()
        .join(', ')
      return context.app.i18n.t(($) => $['commands.name.history'], { username: givenUsername, names: names })
    } catch (error) {
      context.logger.error(error)
      return context.app.i18n.t(($) => $['commands.name.error'], { username: givenUsername })
    }
  }
}

interface AshconResponse {
  uuid: string
  username: string
}
