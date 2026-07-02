import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { getUuidIfExists, usernameNotExists } from '../common/utility.js'

export default class Points extends ChatCommandHandler {
  constructor() {
    super({
      triggers: [
        'points',
        'point',
        'allpoints',
        'allpoint',
        'pointall',
        'pointsall',
        'points30',
        'points30days',
        'point30days',
        '30dayspoints',
        '30dayspoint',
        '30points'
      ],
      description: "Returns user's activity points (use points30 for 30-day)",
      example: `points %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenUsername = context.args[0] ?? context.username
    const is30Days = this.triggerIndicates30Days(context)

    let uuid = context.apiCache.getMojangUuid(givenUsername)
    if (uuid === undefined) {
      uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
      if (uuid !== undefined) context.apiCache.setMojangUuid(givenUsername, uuid)
    }
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    const allPoints = is30Days
      ? context.app.core.scoresManager.getPoints30Days()
      : context.app.core.scoresManager.getPointsAlltime()
    const user = allPoints.find((entry) => entry.uuid === uuid)
    if (user === undefined) return `${givenUsername} does not have any activity`

    const label = is30Days ? '30 days' : 'all time'
    let response = `${givenUsername} ${label} points:`
    response += ` total ${user.total.toLocaleString('en-US')}`
    response += ` | chat ${user.chat.toLocaleString('en-US')}`
    response += ` | online ${user.online.toLocaleString('en-US')}`
    response += ` | commands ${user.commands.toLocaleString('en-US')}`

    return response
  }

  private triggerIndicates30Days(context: ChatCommandContext): boolean {
    const firstWord = context.message.message.split(' ')[0]?.toLowerCase() ?? ''
    const usedTrigger = firstWord.startsWith(context.commandPrefix)
      ? firstWord.slice(context.commandPrefix.length)
      : firstWord
    return usedTrigger.includes('30')
  }
}
