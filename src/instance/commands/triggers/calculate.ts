/*
 CREDIT: Idea by Aura
 Discord: Aura#5051
 Minecraft username: _aura
*/
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Calculate extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Utility',
      triggers: ['calculate', 'calc', 'c', 'math'],
      description: 'A basic calculator',
      example: `calc 1+1`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if (context.args.length === 0) return `${context.username}, example: !calc 1 + 1`

    const expression = context.args.join(' ').replaceAll(':', '/').replaceAll('x', '*').replaceAll(',', '')

    try {
      const mathjs = await import('mathjs')
      const result = mathjs.evaluate(expression) as number

      if (result <= 50 && result >= -50 && Math.random() < 0.2) {
        return `${context.username} haiyaaaaaaaaa this is so easy, you're a disappointment *takes off slipper* (answer: ${result.toLocaleString()})`
      }

      return `${context.username}, answer: ${result.toLocaleString()}`
    } catch {
      return `${context.username}, invalid math expression`
    }
  }
}
