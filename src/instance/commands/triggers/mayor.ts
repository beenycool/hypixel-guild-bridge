import assert from 'node:assert'

import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { formatTime } from '../../../utility/shared-utility.js'
import { SkyblockEvents } from '../../../utility/skyblock-instant.js'
import { capitalize } from '../common/utility.js'

export default class Mayor extends ChatCommandHandler {
  constructor() {
    super({
      category: 'SkyBlock',
      triggers: ['mayor', 'm', 'election'],
      description: 'Show the current Hypixel Skyblock mayor or active election',
      example: `mayor | mayor special`,
      subcommands: [
        {
          name: 'special',
          description: 'Show when Skyblock special mayors are coming',
          example: `mayor special`
        }
      ]
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if ((context.args[0] ?? '').toLowerCase() === 'special') return this.specialMayors()

    const government = await context.app.hypixelApi.getSkyblockGovernment({ raw: true })

    if (government.current !== undefined) {
      const candidates = government.current.candidates
      const resultsHidden = candidates[0].votes === undefined
      if (resultsHidden) {
        return `Hidden Election: ${candidates
          .map((candidate) => `${candidate.name} ${candidate.perks.length} perks`)
          .join(' | ')}`
      }

      let winner = candidates[0]
      for (const candidate of candidates) {
        assert.ok(candidate.votes !== undefined)
        assert.ok(winner.votes !== undefined)
        if (candidate.votes > winner.votes) winner = candidate
      }

      let minister = candidates.find((candidate) => candidate.name !== winner.name)
      assert.ok(minister !== undefined)
      for (const candidate of candidates) {
        if (candidate.name === winner.name) continue

        assert.ok(candidate.votes !== undefined)
        assert.ok(minister.votes !== undefined)
        if (candidate.votes > minister.votes) minister = candidate
      }

      let message = `Upcoming election: `
      message += `${winner.name} (${winner.perks.map((perk) => perk.name).join(', ')})`
      message += ' | '
      message += `${minister.name} (${minister.perks
        .filter((perk) => perk.minister)
        .map((perk) => perk.name)
        .join(', ')})`
      return message
    }

    let message = `Elected Mayor: `
    message += `${government.mayor.name} (${government.mayor.perks.map((perk) => perk.name).join(', ')})`
    if (government.mayor.minister !== undefined) {
      message += ' | '
      message += `${government.mayor.minister.name} (${government.mayor.minister.perk.name})`
    }
    return message
  }

  private specialMayors(): string {
    const currentTime = Date.now()
    const specialMayors = Object.entries(SkyblockEvents.getSpecialMayors(currentTime)).toSorted(
      ([, a], [, b]) => a.time - b.time
    )

    const result: string[] = []

    for (const [name, appointment] of specialMayors) {
      let mayorResult = ''
      mayorResult += capitalize(name)

      switch (appointment.type) {
        case 'future': {
          mayorResult += ' in '
          break
        }
        case 'happening': {
          mayorResult += ' till '
          break
        }
        default: {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          throw new Error(`${appointment.type} is not a valid appointment type`)
        }
      }

      mayorResult += formatTime(appointment.time - currentTime)
      result.push(mayorResult)
    }

    return `Special Mayors: ${result.join(' | ')}`
  }
}
