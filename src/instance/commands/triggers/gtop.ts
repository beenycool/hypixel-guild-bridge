import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class GtopCommand extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Guild',
      triggers: ['gtop', 'topgexp'],
      description: 'Shows the top 5 GEXP earners in the guild for today',
      example: 'gtop'
    })
  }

  public async handler(context: ChatCommandContext): Promise<string> {
    const instances = context.app.minecraftManager.getAllInstances()
    const botUuid = instances[0]?.uuid()
    if (!botUuid) return 'No Minecraft instance is connected to fetch guild data.'

    let guild
    try {
      guild = await context.app.hypixelApi.getGuild('player', botUuid, {})
    } catch {
      return 'Failed to fetch guild data.'
    }

    const topMembers = guild.members
      .map((member) => {
        const latestExp = this.getLatestExp(member.expHistory)
        return { uuid: member.uuid, exp: latestExp }
      })
      .toSorted((a, b) => b.exp - a.exp)
      .slice(0, 5)

    const lines = await Promise.all(
      topMembers.map(async (entry, index) => {
        let name = entry.uuid
        try {
          const profile = await context.app.mojangApi.profileByUuid(entry.uuid)
          name = profile.name
        } catch {}
        return `${index + 1}. ${name} (${entry.exp.toLocaleString()} EXP)`
      })
    )

    return `Top GEXP Today:\n${lines.join('\n')}`
  }

  private getLatestExp(expHistory: { day: string; date: Date; exp: number; totalExp: number }[]): number {
    if (expHistory.length === 0) return 0
    const sorted = [...expHistory].toSorted((a, b) => b.date.getTime() - a.date.getTime())
    return sorted[0]?.exp ?? 0
  }
}
