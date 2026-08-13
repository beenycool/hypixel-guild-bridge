import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

function percentage(): number {
  return Math.floor(Math.random() * 200) + 1
}

export default class Lesbian extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Fun',
      triggers: ['lesbian', 'lesbianism'],
      description: 'Check how lesbian a player is',
      example: 'lesbian %s'
    })
  }

  private readonly person1Aliases = ['pgqn', 'pigeon']
  private readonly person2Aliases = ['table', 'tunc', 'triple t', 'tieam', 'team']

  private matches(name: string, aliases: string[]): boolean {
    return aliases.includes(name.toLowerCase())
  }

  handler(context: ChatCommandContext): string {
    const user1 = context.args[0] ?? context.username
    if (context.args[1]) {
      const user2 = context.args.slice(1).join(' ')
      const p1 = user1.toLowerCase()
      const p2 = user2.toLowerCase()

      const isPigeon = this.matches(p1, this.person1Aliases) && this.matches(p2, this.person2Aliases)
      const isTable = this.matches(p1, this.person2Aliases) && this.matches(p2, this.person1Aliases)

      if (isPigeon || isTable) {
        return `${user1} and ${user2} are 6900% lesbian couple.`
      }
      return `${user1} and ${user2} are ${percentage()}% lesbian couple.`
    }
    return `${user1} is ${percentage()}% lesbian.`
  }
}
