import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { skyblockViews } from '../common/skyblock-views/registry.js'
import type { SkyblockView } from '../common/skyblock-views/types.js'
import {
  getSelectedSkyblockProfileData,
  getUuidIfExists,
  playerNeverPlayedSkyblock,
  usernameNotExists
} from '../common/utility.js'

const MaxViewsPerCommand = 4

interface RequestedView {
  view: SkyblockView
  args: string[]
}

interface ViewResolution {
  username: string
  views: RequestedView[]
  error: string | undefined
}

export default class Skyblock extends ChatCommandHandler {
  constructor() {
    super({
      category: 'SkyBlock',
      triggers: ['skyblock', 'sb', 'stats'],
      description: "Returns a player's skyblock stats",
      example: `sb %s | sb %s forge | sb %s forge skills purse`,
      subcommands: skyblockViews.map((view) => ({
        name: view.name,
        description: view.description,
        example: view.example
      }))
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const resolution = this.resolveViews(context)
    if (resolution.error) return resolution.error

    const uuid = await getUuidIfExists(context.app.mojangApi, resolution.username)
    if (uuid == undefined) return usernameNotExists(context, resolution.username)

    const needsProfile = resolution.views.some(({ view }) => view.needsProfile)
    const selected = needsProfile ? await getSelectedSkyblockProfileData(context.app.hypixelApi, uuid) : undefined
    if (needsProfile && !selected) return playerNeverPlayedSkyblock(context, resolution.username)

    const responses = await Promise.all(
      resolution.views.map(({ view, args }) => view.render(context, resolution.username, uuid, selected, args))
    )

    return responses.join(' | ')
  }

  private resolveViews(context: ChatCommandContext): ViewResolution {
    const viewsByName = new Map(skyblockViews.map((view) => [view.name, view]))

    let username: string | undefined
    const views: RequestedView[] = []
    let current: RequestedView | undefined

    for (const token of context.args) {
      const view = viewsByName.get(token.toLowerCase())
      if (view !== undefined) {
        current = { view: view, args: [] }
        views.push(current)
      } else if (username === undefined) {
        username = token
      } else if (current === undefined) {
        return {
          username: context.username,
          views: [],
          error: `Unknown skyblock stat "${token}". Available stats: ${[...viewsByName.keys()].join(', ')}.`
        }
      } else {
        current.args.push(token)
      }
    }

    if (views.length > MaxViewsPerCommand) {
      return {
        username: username ?? context.username,
        views: [],
        error: `Too many skyblock stats. Maximum is ${MaxViewsPerCommand} per command.`
      }
    }

    if (views.length === 0) {
      const summaryView = viewsByName.get('summary')
      if (summaryView === undefined) throw new Error('Summary skyblock view is not registered')
      views.push({ view: summaryView, args: [] })
    }

    return { username: username ?? context.username, views: views, error: undefined }
  }
}
