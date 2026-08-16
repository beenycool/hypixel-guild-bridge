import type { ChatEvent } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { Timeout } from '../../../utility/timeout.js'

const CalculusAliases = new Set(['calculus', 'calculas', 'calc'])

export default class Asian extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Fun',
      triggers: ['asian'],
      description: 'Challenge yourself with math! Use calculus for calculus problems.',
      example: `asian %s`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const mode = context.args[0]?.toLowerCase()

    if (CalculusAliases.has(mode)) {
      const problem = this.createCalculus()
      return this.runChallenge(context, problem, 15_000)
    }

    const problem = this.createMath()
    return this.runChallenge(context, problem, 7000)
  }

  private async runChallenge(
    context: ChatCommandContext,
    problem: { expression: string; answer: number },
    timeoutMs: number
  ): Promise<string> {
    const timeout = new Timeout<number>(timeoutMs)

    const listener = (event: ChatEvent) => {
      if (!event.user.equalsUser(context.message.user)) return

      const match = /^\d+/g.exec(event.message)
      if (!match) return

      const guess = Number.parseInt(match[0], 10)
      if (guess === problem.answer) timeout.resolve(guess)
    }

    context.app.on('chat', listener)
    await context.sendFeedback(`${context.username}, quick: ${problem.expression}`)
    timeout.refresh()

    const result = await timeout.wait()
    context.app.off('chat', listener)

    if (result === problem.answer) {
      return 'Big brain!'
    } else {
      return `haiyaaaaaaaaa this is so easy, you're a disappointment *takes off slipper* (answer: ${problem.answer})`
    }
  }

  private createCalculus(): { expression: string; answer: number } {
    const variant = Math.random()

    if (variant < 0.6) {
      const n = Math.floor(Math.random() * 4) + 2
      const a = Math.floor(Math.random() * 5) + 2
      return {
        expression: `d/dx(x^${n}) at x = ${a}`,
        answer: n * Math.pow(a, n - 1)
      }
    } else if (variant < 0.8) {
      const a = Math.floor(Math.random() * 9) + 2
      return {
        expression: `∫ 2x dx from 0 to ${a}`,
        answer: a * a
      }
    } else {
      const a = Math.floor(Math.random() * 5) + 2
      return {
        expression: `∫ 3x^2 dx from 0 to ${a}`,
        answer: a * a * a
      }
    }
  }

  private createMath(): { expression: string; answer: number } {
    const possibilities = [
      ...Array.from({ length: 5 }).fill('multiplication'),
      ...Array.from({ length: 3 }).fill('addition'),
      ...Array.from({ length: 3 }).fill('subtraction'),
      ...Array.from({ length: 3 }).fill('division'),
      ...Array.from({ length: 8 }).fill('hard')
    ] as ('multiplication' | 'addition' | 'subtraction' | 'division' | 'hard')[]

    const selected = possibilities[Math.floor(Math.random() * possibilities.length)]
    switch (selected) {
      case 'multiplication': {
        const a = Math.round(Math.random() * 20) + 1
        const b = Math.round(Math.random() * 20) + 1
        return { expression: `${a} * ${b}`, answer: a * b }
      }
      case 'addition': {
        const a = Math.round(Math.random() * 500) + 1
        const b = Math.round(Math.random() * 500) + 1
        return { expression: `${a} + ${b}`, answer: a + b }
      }
      case 'subtraction': {
        const a = Math.round(Math.random() * 500) + 1
        const b = Math.round(Math.random() * a)
        return { expression: `${a} - ${b}`, answer: a - b }
      }
      case 'division': {
        for (let tries = 0; tries < 100; tries++) {
          const a = Math.round(Math.random() * 500) + 1
          const b = Math.round(Math.random() * 500) + 1
          if (a % b !== 0) continue
          return { expression: `${a} / ${b}`, answer: a / b }
        }

        break
      }
      case 'hard': {
        const a = Math.round(Math.random() * 30) + 1
        const b = Math.round(Math.random() * 30) + 1
        const c = Math.round(Math.random() * 30) + 1
        const d = Math.round(Math.random() * 30) + 1
        return { expression: `${a} * ${b} + ${c} * ${d}`, answer: a * b + c * d }
      }
    }

    throw new Error("Can't find a good math expression")
  }
}
