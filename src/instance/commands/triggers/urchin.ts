import { isAxiosError } from 'axios'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { httpClient } from '../../../common/http.js'
import { getUuidIfExists, usernameNotExists } from '../common/utility.js'

interface UrchinTag {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case field required by the Urchin API
  tag_type: string
  reason: string
}

interface UrchinResponse {
  uuid: string
  displayname?: string | null
  tags?: UrchinTag[]
}

interface SeraphBlacklist {
  tagged?: boolean
  reason?: string
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case field required by the Seraph API
  report_type?: string
  verified?: boolean
  tooltip?: string
}

interface SeraphAnnoylist {
  tagged?: boolean
  tooltip?: string
}

interface SeraphNameChange {
  tagged?: boolean
  tooltip?: string
}

interface SeraphSafelist {
  tagged?: boolean
  personal?: boolean
  tooltip?: string
}

interface SeraphStatistics {
  encounters?: number
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case field required by the Seraph API
  threat_level?: number
}

interface SeraphData {
  username?: string
  uuid?: string
  blacklist?: SeraphBlacklist
  annoylist?: SeraphAnnoylist
  // eslint-disable-next-line @typescript-eslint/naming-convention -- snake_case field required by the Seraph API
  name_change?: SeraphNameChange
  safelist?: SeraphSafelist
  statistics?: SeraphStatistics
  customTag?: string
}

interface SeraphResponse {
  success?: boolean
  code?: number
  data?: SeraphData
}

interface CheckResult {
  hasNoTags: boolean
  message: string
}

export default class Urchin extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Player',
      triggers: ['urchin', 'blacklist', 'tags'],
      description: 'Check a player for Urchin and Seraph blacklist tags.',
      example: 'urchin %s'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username

    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    const [urchinResult, seraphResult] = await Promise.all([
      this.getUrchinSection(context, givenUsername, uuid),
      this.getSeraphSection(context, givenUsername, uuid)
    ])

    if (urchinResult.hasNoTags && seraphResult.hasNoTags) {
      return context.app.i18n.t(($) => $['commands.urchin.no-both-tags'], { username: givenUsername })
    }

    return [urchinResult.message, seraphResult.message].join('\n')
  }

  private async getUrchinSection(context: ChatCommandContext, username: string, uuid: string): Promise<CheckResult> {
    const urchinApiKey = context.app.urchinApiKey

    if (!urchinApiKey) {
      return {
        hasNoTags: false,
        message: context.app.i18n.t(($) => $['commands.urchin.no-key'])
      }
    }

    try {
      const response = await httpClient.get(`https://api.urchin.gg/v3/player/tags`, {
        params: {
          player: uuid
        },
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the Urchin API
          'X-API-Key': urchinApiKey
        }
      })

      const { data } = response as { data: unknown }
      const urchinData = data as UrchinResponse
      if (!urchinData.tags || urchinData.tags.length === 0) {
        return {
          hasNoTags: true,
          message: context.app.i18n.t(($) => $['commands.urchin.no-tags'], { username })
        }
      }

      const tags = urchinData.tags.map((tag) => `${tag.tag_type}: ${tag.reason}`).join(', ')
      return {
        hasNoTags: false,
        message: context.app.i18n.t(($) => $['commands.urchin.tags'], { username, tags })
      }
    } catch (error: unknown) {
      if (isAxiosError(error) && error.response?.status === 404) {
        return {
          hasNoTags: true,
          message: context.app.i18n.t(($) => $['commands.urchin.not-found'], { username })
        }
      }
      if (isAxiosError(error) && error.response?.status === 401) {
        return {
          hasNoTags: false,
          message: context.app.i18n.t(($) => $['commands.urchin.invalid-key'])
        }
      }
      if (isAxiosError(error) && error.response?.status === 403) {
        return {
          hasNoTags: false,
          message: context.app.i18n.t(($) => $['commands.urchin.locked-key'])
        }
      }
      context.logger.error(error)
      return {
        hasNoTags: false,
        message: context.app.i18n.t(($) => $['commands.urchin.error'], { username })
      }
    }
  }

  private async getSeraphSection(context: ChatCommandContext, username: string, uuid: string): Promise<CheckResult> {
    const seraphApiKey = context.app.seraphApiKey

    if (!seraphApiKey) {
      return {
        hasNoTags: false,
        message: context.app.i18n.t(($) => $['commands.seraph.no-key'])
      }
    }

    try {
      const response = await httpClient.get(`https://api.seraph.si/${uuid}/blacklist`, {
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the Seraph API
          'seraph-api-key': seraphApiKey
        }
      })

      const { data } = response as { data: unknown }
      const seraphData = data as SeraphResponse
      const tags = this.getSeraphTags(seraphData.data)
      if (tags.length === 0) {
        return {
          hasNoTags: true,
          message: context.app.i18n.t(($) => $['commands.seraph.no-tags'], { username })
        }
      }

      return {
        hasNoTags: false,
        message: context.app.i18n.t(($) => $['commands.seraph.tags'], { username, tags: tags.join(', ') })
      }
    } catch (error: unknown) {
      if (isAxiosError(error) && error.response?.status === 403) {
        return {
          hasNoTags: false,
          message: context.app.i18n.t(($) => $['commands.seraph.invalid-key'])
        }
      }
      context.logger.error(error)
      return {
        hasNoTags: false,
        message: context.app.i18n.t(($) => $['commands.seraph.error'], { username })
      }
    }
  }

  private getSeraphTags(data: SeraphData | undefined): string[] {
    const tags: string[] = []
    if (!data) return tags

    if (data.blacklist?.tagged) {
      const verified = data.blacklist.verified ? ' (verified)' : ''
      tags.push(`blacklist: ${data.blacklist.reason ?? 'unknown'}${verified}`)
    }
    if (data.annoylist?.tagged) tags.push(`annoylist: ${data.annoylist.tooltip ?? 'yes'}`)
    if (data.name_change?.tagged) tags.push(`name change: ${data.name_change.tooltip ?? 'yes'}`)
    if (data.safelist?.tagged) tags.push(`safelist: ${data.safelist.personal ? 'personal' : 'global'}`)
    if (data.customTag) tags.push(`custom tag: ${data.customTag}`)
    if (data.statistics?.threat_level && data.statistics.threat_level > 0) {
      tags.push(`threat level: ${data.statistics.threat_level}`)
    }
    return tags
  }
}
