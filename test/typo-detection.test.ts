import assert from 'node:assert'
import { describe, test } from 'node:test'

import {
  calculateSimilarityScore,
  ChatCommandHandler,
  getClosestCommand,
  getCommandSuggestions
} from '../src/common/commands.js'

class TestCommand extends ChatCommandHandler {
  constructor(triggers: string[]) {
    super({
      triggers,
      description: 'Test command',
      example: 'test'
    })
  }

  handler() {
    return 'test response'
  }
}

const MockCommands = [
  new TestCommand(['help']),
  new TestCommand(['player']),
  new TestCommand(['guild']),
  new TestCommand(['skills']),
  new TestCommand(['duels']),
  new TestCommand(['bedwars']),
  new TestCommand(['skyblock']),
  new TestCommand(['networth'])
]

await describe('Typo Detection and Suggestion', async () => {
  await test('should find exact matches', () => {
    const suggestions = getCommandSuggestions(MockCommands, 'help')
    assert.strictEqual(suggestions.length, 1)
    assert.ok(suggestions[0].command.triggers.includes('help'))
    assert.strictEqual(suggestions[0].score, 100)
  })

  await test('should suggest similar commands for typos', () => {
    const suggestions = getCommandSuggestions(MockCommands, 'helps')
    assert.ok(suggestions.length > 0)
    assert.ok(suggestions[0].command.triggers.includes('help'))
  })

  await test('should suggest similar commands for partial matches', () => {
    const suggestions = getCommandSuggestions(MockCommands, 'play')
    assert.ok(suggestions.length > 0)
    assert.ok(suggestions[0].command.triggers.includes('player'))
  })

  await test('should get closest command', () => {
    const closest = getClosestCommand(MockCommands, 'skil')
    assert.notStrictEqual(closest, undefined)
    assert.ok(closest?.command.triggers.includes('skills'))
  })

  await test('should calculate similarity scores correctly', () => {
    assert.strictEqual(calculateSimilarityScore('help', 'help'), 1)
    assert.ok(calculateSimilarityScore('hel', 'help') > 0.5)
    assert.ok(calculateSimilarityScore('xyz', 'help') < 0.3)
  })

  await test('should return undefined for no close matches', () => {
    const closest = getClosestCommand(MockCommands, 'nonexistentcommand123')
    assert.strictEqual(closest, undefined)
  })

  await test('should handle case insensitivity', () => {
    const suggestions = getCommandSuggestions(MockCommands, 'HELP')
    assert.strictEqual(suggestions.length, 1)
    assert.ok(suggestions[0].command.triggers.includes('help'))
  })
})
