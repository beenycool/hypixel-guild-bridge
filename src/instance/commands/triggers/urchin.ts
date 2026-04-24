import axios from 'axios'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { getUuidIfExists, usernameNotExists } from '../common/utility.js'

interface UrchinTag {
  type: string
  reason: string
}

interface UrchinResponse {
  tags?: UrchinTag[]
}

export default class Urchin extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['urchin', 'blacklist', 'tags'],
      description: 'Check a player for Urchin blacklist tags.',
      example: 'urchin %s'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const urchinApiKey = context.app.urchinApiKey

    if (!urchinApiKey) {
      return context.app.i18n.t(($) => $['commands.urchin.no-key'])
    }

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    try {
      const response = await axios.get(`https://urchin.ws/player/${uuid}`, {
        params: {
          key: urchinApiKey,
          sources: 'CHAT'
        }
      })

      const data = response.data as UrchinResponse
      if (!data.tags || data.tags.length === 0) {
        return context.app.i18n.t(($) => $['commands.urchin.no-tags'], { username: givenUsername })
      }

      const tags = data.tags.map((tag) => `${tag.type}: ${tag.reason}`).join(', ')
      return context.app.i18n.t(($) => $['commands.urchin.tags'], { username: givenUsername, tags })
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return context.app.i18n.t(($) => $['commands.urchin.not-found'], { username: givenUsername })
      }
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return context.app.i18n.t(($) => $['commands.urchin.invalid-key'])
      }
      context.logger.error(error)
      return context.app.i18n.t(($) => $['commands.urchin.error'], { username: givenUsername })
    }
  }
}
