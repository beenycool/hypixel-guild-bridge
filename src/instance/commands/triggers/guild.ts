import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import Duration from '../../../utility/duration'
import { formatTime } from '../../../utility/shared-utility'
import { getUuidIfExists, usernameNotExists } from '../common/utility'

export default class Guild extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Guild',
      triggers: ['guild', 'guildOf', 'g'],
      description: "Returns a guild's stats, or a player's membership with `member`",
      example: `g %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if (context.args[0] === 'member') return this.onGuildMember(context, context.args[1] ?? context.username)
    if (context.args.length === 0) return this.onGuildMember(context, context.username)

    const givenName = context.args[0]
    const guild = await context.app.hypixelApi.getGuild('name', givenName, {}).catch(() => undefined)

    // no guild by that name? it was probably a player all along. classic.
    if (guild == undefined) return this.onGuildMember(context, givenName)

    let result = guild.name
    result += ` | Level: ${guild.level}`
    result += ` | Members: ${guild.members.length}/125`

    const weeklyGexp = guild.members.reduce((sum, member) => sum + member.weeklyExperience, 0)
    result += ` | Total GEXP this week: ${weeklyGexp.toLocaleString('en-US')}`

    if (guild.createdAtTimestamp) {
      const duration = Date.now() - guild.createdAtTimestamp
      const days = Math.floor(duration / Duration.days(1).toMilliseconds())

      result += ` | existing for `
      result += days > 0 ? `${days} days` : formatTime(duration)
    }
    return result
  }

  private async onGuildMember(context: ChatCommandContext, givenUsername: string): Promise<string> {
    const uuid = await getUuidIfExists(context.app.mojangApi, givenUsername)
    if (uuid == undefined) return usernameNotExists(context, givenUsername)

    const guild = await context.app.hypixelApi.getGuild('player', uuid, {}).catch(() => undefined)
    if (guild == undefined) return `${givenUsername} is not in a guild.`

    const member = guild.members.find((m: { uuid: string }) => m.uuid === uuid)

    let result = givenUsername
    result += ` in ${guild.name} (${guild.members.length}/125)`
    result += ` as ${member?.rank ?? 'unknown'}`
    if (member?.joinedAtTimestamp) {
      const duration = Date.now() - member.joinedAtTimestamp
      const days = Math.floor(duration / Duration.days(1).toMilliseconds())

      result += ` for the last `
      result += days > 0 ? `${days} days` : formatTime(duration)
    }
    if (member?.weeklyExperience) result += ` with GEXP this week ${member.weeklyExperience.toLocaleString('en-US')}`
    return result
  }
}
