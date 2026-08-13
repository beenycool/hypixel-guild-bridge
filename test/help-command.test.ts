import assert from 'node:assert'
import { describe, test } from 'node:test'

import { ChatCommandHandler, formatCommandHelp } from '../src/common/commands.js'
import { resolveDungeonView } from '../src/instance/commands/triggers/catacomb.js'
import Help, {
  buildCommandLines,
  listCategories,
  paginateLines,
  searchCommandsByKeyword
} from '../src/instance/commands/triggers/help.js'

class TestCommand extends ChatCommandHandler {
  constructor(triggers: string[], category?: string) {
    super({
      triggers,
      description: 'Test command',
      example: 'test %s',
      category
    })
  }

  handler() {
    return 'test response'
  }
}

const MockCommands = [
  new TestCommand(['help', 'cmd'], 'Utility'),
  new TestCommand(['networth', 'nw'], 'SkyBlock'),
  new TestCommand(['skills', 'skill'], 'SkyBlock'),
  new TestCommand(['player'], 'Player'),
  new TestCommand(['iq'], 'Fun'),
  new TestCommand(['chat', 'q'], 'Utility'),
  new TestCommand(['punish'], 'Moderation')
]

function makeContext(
  commands: ChatCommandHandler[],
  argumentValues: string[],
  message = '!help'
): ChatCommandContextLike {
  return {
    allCommands: commands,
    commandPrefix: '!',
    args: argumentValues,
    username: 'Steve',
    message: {
      message
    } as ChatCommandContextLike['message'],
    app: {
      core: {
        commandsConfigurations: {
          getDisabledCommands: () => []
        }
      }
    }
  }
}

interface ChatCommandContextLike {
  allCommands: ChatCommandHandler[]
  commandPrefix: string
  args: string[]
  username: string
  message: { message: string }
  app: {
    core: {
      commandsConfigurations: {
        getDisabledCommands: () => string[]
      }
    }
  }
}

await describe('Help Command', async () => {
  await test('!help lists categories only, sorted', () => {
    const help = new Help()
    const output = help.handler(makeContext(MockCommands, []) as never)
    assert.match(output, /^Commands - !help <category> for details: /)
    assert.match(output, /Fun/)
    assert.match(output, /Moderation/)
    assert.match(output, /Player/)
    assert.match(output, /SkyBlock/)
    assert.match(output, /Utility/)
    assert.ok(!output.includes('networth'), 'should not list commands')
  })

  await test("!help <category> lists that category's commands", () => {
    const help = new Help()
    const output = help.handler(makeContext(MockCommands, ['skyblock']) as never)
    assert.match(output, /^\[SkyBlock\] \(page 1 of 1\)/)
    assert.match(output, /networth/)
    assert.match(output, /skills/)
    assert.ok(!output.includes('player'), 'should not include other categories')
  })

  await test('!help <command> shows rich detail with category and aliases', () => {
    const help = new Help()
    const output = help.handler(makeContext(MockCommands, ['networth']) as never)
    assert.match(output, /^\[SkyBlock\] networth: Test command \(aliases: nw\) - Example: !test Steve$/)
  })

  await test('!help <command> caps the alias list to keep under the 256 char limit', () => {
    const longAliasCommand = new TestCommand(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'SkyBlock')
    const output = formatCommandHelp(longAliasCommand, '!', 'Steve')
    assert.ok(output.length <= 256)
    assert.match(output, /\(aliases: b, c, d, e, f, \.\.\.\)/)
  })

  await test('formatCommandHelp truncates oversized examples as a last resort', () => {
    const longCommand = new TestCommand(['a', 'b'], 'SkyBlock')
    Object.assign(longCommand, {
      description: 'A very long description that fills up space '.repeat(4),
      example: 'a %s | b %s with lots of extra example text '.repeat(6)
    })
    const output = formatCommandHelp(longCommand, '!', 'SteveWithAReallyLongUsername')
    assert.ok(output.length <= 200, `output too long: ${output.length}`)
    assert.ok(output.endsWith('...'))
  })

  await test('!help <typo> suggests similar commands', () => {
    const help = new Help()
    const output = help.handler(makeContext(MockCommands, ['nterworth']) as never)
    assert.match(output, /^Command "nterworth" does not exist\. Did you mean/)
    assert.match(output, /networth/)
  })

  await test('!help <keyword> searches triggers, descriptions and categories', () => {
    const help = new Help()
    const output = help.handler(makeContext(MockCommands, ['worth']) as never)
    assert.match(output, /^Commands matching "worth": networth$/)
  })

  await test('!help <unknown> with no suggestions gives a fallback', () => {
    const help = new Help()
    const output = help.handler(makeContext(MockCommands, ['zzzznonexistent']) as never)
    assert.match(output, /^Command "zzzznonexistent" does not exist\. Use !help to list all categories\.$/)
  })

  await test('all help outputs stay below the 256 char Minecraft limit', () => {
    const help = new Help()
    const context = makeContext(MockCommands, [])
    const argumentSets = [[], ['skyblock'], ['networth'], ['nterworth'], ['worth'], ['2']]
    for (const argumentSet of argumentSets) {
      const output = help.handler({ ...context, args: argumentSet } as never)
      assert.ok(output.length <= 256, `output too long for args ${argumentSet.join(' ')}: ${output}`)
    }
  })

  await test('listCategories returns unique sorted categories and respects disabled commands', () => {
    const categories = listCategories(MockCommands, [])
    assert.deepStrictEqual(categories, ['Fun', 'Moderation', 'Player', 'SkyBlock', 'Utility'])

    const withDisabled = listCategories(MockCommands, ['networth'])
    assert.deepStrictEqual(withDisabled, ['Fun', 'Moderation', 'Player', 'SkyBlock', 'Utility'])
  })

  await test('buildCommandLines groups commands by category and wraps lines', () => {
    const commands = [
      ...MockCommands,
      new TestCommand(['averylongcommandname'], 'SkyBlock'),
      new TestCommand(['anotherlongcommandname'], 'SkyBlock'),
      new TestCommand(['yetanotherlongcommandname'], 'SkyBlock')
    ]
    const lines = buildCommandLines(commands, [])
    for (const line of lines) {
      assert.ok(line.length <= 120, `line too long: ${line}`)
    }
    assert.ok(lines.some((line) => line.startsWith('SkyBlock: ')))
    assert.ok(lines.some((line) => line.startsWith('Utility: ')))
  })

  await test('paginateLines keeps pages below the length limit', () => {
    const lines = Array.from({ length: 30 }, (unused, index) => `Some long command line number ${index + 1} here`)
    const pages = paginateLines(lines, 200)
    assert.ok(pages.length > 1)
    for (const page of pages) {
      const length = page.join(' | ').length
      assert.ok(length <= 200, `page too long: ${length}`)
    }
  })

  await test('searchCommandsByKeyword matches triggers, descriptions and category names', () => {
    const byTrigger = searchCommandsByKeyword(MockCommands, 'worth')
    assert.deepStrictEqual(
      byTrigger.map((c) => c.triggers[0]),
      ['networth']
    )

    const byCategory = searchCommandsByKeyword(MockCommands, 'sky')
    assert.deepStrictEqual(
      byCategory.map((c) => c.triggers[0]),
      ['networth', 'skills']
    )

    const byDescription = searchCommandsByKeyword([new TestCommand(['xyz'], 'Fun')], 'test')
    assert.deepStrictEqual(
      byDescription.map((c) => c.triggers[0]),
      ['xyz']
    )
  })
})

await describe('Catacomb Dungeon Views', async () => {
  await test('resolves views from legacy triggers', () => {
    assert.strictEqual(resolveDungeonView('pb', ['Steve', 'm7']), 'pb')
    assert.strictEqual(resolveDungeonView('cd', ['Steve']), 'last')
    assert.strictEqual(resolveDungeonView('runs', ['mm', 'Steve']), 'runs')
    assert.strictEqual(resolveDungeonView('secrets', ['Steve']), 'secrets')
    assert.strictEqual(resolveDungeonView('rtca', ['Steve', 'm7', '50']), 'rtca')
    assert.strictEqual(resolveDungeonView('catacombs', ['Steve']), 'stats')
  })

  await test('resolves views from subcommands on the cata trigger', () => {
    assert.strictEqual(resolveDungeonView('cata', ['stats', 'Steve']), 'stats')
    assert.strictEqual(resolveDungeonView('cata', ['pb', 'Steve', 'm7']), 'pb')
    assert.strictEqual(resolveDungeonView('cata', ['last', 'Steve']), 'last')
    assert.strictEqual(resolveDungeonView('cata', ['runs', 'mm', 'Steve']), 'runs')
    assert.strictEqual(resolveDungeonView('cata', ['secrets', 'Steve']), 'secrets')
    assert.strictEqual(resolveDungeonView('cata', ['rtca', 'Steve', 'm7', '50']), 'rtca')
    assert.strictEqual(resolveDungeonView('cata', ['Steve']), 'stats')
    assert.strictEqual(resolveDungeonView('cata', []), 'stats')
  })
})
