import assert from 'node:assert'
import { describe, test } from 'node:test'

import {
  calculateDamerauLevenshteinDistance,
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
  new TestCommand(['guildexp']),
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
    assert.strictEqual(suggestions[0].score, 1)
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

  await test('should treat adjacent transpositions as a single edit', () => {
    assert.strictEqual(calculateDamerauLevenshteinDistance('hlep', 'help'), 1)
    assert.strictEqual(calculateDamerauLevenshteinDistance('bedwasr', 'bedwars'), 1)
    assert.ok(calculateSimilarityScore('bedwasr', 'bedwars') > 0.6)
  })

  await test('should suggest commands for transposition typos', () => {
    const closest = getClosestCommand(MockCommands, 'bedwasr')
    assert.notStrictEqual(closest, undefined)
    assert.ok(closest?.command.triggers.includes('bedwars'))

    const hlepSuggestion = getClosestCommand(MockCommands, 'hlep')
    assert.notStrictEqual(hlepSuggestion, undefined)
    assert.ok(hlepSuggestion?.command.triggers.includes('help'))
  })

  await test('should tolerate multiple edits on longer commands', () => {
    assert.ok(calculateSimilarityScore('nterworth', 'networth') > 0.6)
    const closest = getClosestCommand(MockCommands, 'nterworth')
    assert.notStrictEqual(closest, undefined)
    assert.ok(closest?.command.triggers.includes('networth'))
  })

  await test('should rank exact-length typo matches above substring matches', () => {
    const suggestions = getCommandSuggestions(MockCommands, 'guildx', 3)
    assert.strictEqual(suggestions[0]?.command.triggers[0], 'guild')
    assert.strictEqual(suggestions[0]?.score, calculateSimilarityScore('guildx', 'guild'))
    for (const suggestion of suggestions.slice(1)) {
      assert.ok(suggestion.score < (suggestions[0]?.score ?? 0))
    }
  })

  await test('should not suggest anything for very short queries', () => {
    const suggestions = getCommandSuggestions(MockCommands, 'gg')
    assert.strictEqual(suggestions.length, 0)
    assert.strictEqual(getClosestCommand(MockCommands, 'gg'), undefined)
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
