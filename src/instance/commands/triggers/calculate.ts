/*
 CREDIT: Idea by Aura
 Discord: Aura#5051
 Minecraft username: _aura
*/
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

function formatResult(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Number.POSITIVE_INFINITY) return 'Infinity'
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity'

  const cleaned = Number(value.toPrecision(12))
  if (Number.isInteger(cleaned)) return cleaned.toLocaleString('en-US')

  const rounded = Math.round(cleaned * 1_000_000) / 1_000_000
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

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

    const expression = context.args
      .join(' ')
      .replaceAll(':', '/')
      .replaceAll('x', '*')
      .replaceAll(',', '')
      .replaceAll('%', '*0.01')

    try {
      const mathjs = await import('mathjs')
      const result = mathjs.evaluate(expression) as unknown
      if (typeof result !== 'number') {
        return `${context.username}, invalid math expression`
      }
      const formatted = formatResult(result)

      if (result <= 50 && result >= -50 && Math.random() < 0.2) {
        return `${context.username} haiyaaaaaaaaa this is so easy, you're a disappointment *takes off slipper* (answer: ${formatted})`
      }

      return `${context.username}, answer: ${formatted}`
    } catch {
      return `${context.username}, invalid math expression`
    }
  }
}
