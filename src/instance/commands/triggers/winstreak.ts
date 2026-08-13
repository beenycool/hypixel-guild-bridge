import { isAxiosError } from 'axios'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { httpClient } from '../../../common/http.js'
import { getUuidIfExists, usernameNotExists } from '../common/utility.js'

interface CoralWinstreakResponse {
  uuid: string
  displayname?: string | null
  modes?: Record<string, number>
}

const MODE_ABBR: Record<string, string> = {
  solos: 'Solo',
  doubles: 'Dbl',
  threes: 'Tri',
  fours: 'Quad',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- API mode key from the winstreak response
  '4v4': '4v4',
  overall: 'All',
  core: 'Core'
}

function formatWs(mode: string, count: number): string {
  return `${MODE_ABBR[mode.toLowerCase()] ?? mode}: ${count}ws`
}

export default class WinstreakCommand extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Minigames',
      triggers: ['ws', 'winstreak'],
      description: 'Show winstreaks for a player.',
      example: 'ws %s'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const urchinApiKey = context.app.urchinApiKey

    if (!urchinApiKey) {
      return context.app.i18n.t(($) => $['commands.winstreak.no-key'])
    }

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    try {
      const response = await httpClient.get<CoralWinstreakResponse>(`https://api.urchin.gg/v3/player/winstreaks`, {
        params: { player: uuid },
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the Urchin API
          'X-API-Key': urchinApiKey
        }
      })

      const modes = response.data.modes
      if (!modes) {
        return context.app.i18n.t(($) => $['commands.winstreak.no-data'], { username: givenUsername })
      }

      const entries = Object.entries(modes)
        .map(([mode, winstreak]) => ({ mode, winstreak }))
        .filter((m) => m.winstreak > 0)
        .toSorted((a, b) => b.winstreak - a.winstreak)

      if (entries.length === 0) {
        return context.app.i18n.t(($) => $['commands.winstreak.no-data'], { username: givenUsername })
      }

      const parts = entries.map((m) => formatWs(m.mode, m.winstreak))
      const summary = parts.join(' | ')

      return context.app.i18n.t(($) => $['commands.winstreak.result'], { username: givenUsername, summary })
    } catch (error: unknown) {
      if (isAxiosError(error) && error.response?.status === 404) {
        return context.app.i18n.t(($) => $['commands.winstreak.not-found'], { username: givenUsername })
      }
      if (isAxiosError(error) && error.response?.status === 401) {
        return context.app.i18n.t(($) => $['commands.winstreak.invalid-key'])
      }
      if (isAxiosError(error) && error.response?.status === 403) {
        return context.app.i18n.t(($) => $['commands.winstreak.locked-key'])
      }
      context.logger.error(error)
      return context.app.i18n.t(($) => $['commands.winstreak.error'], { username: givenUsername })
    }
  }
}
