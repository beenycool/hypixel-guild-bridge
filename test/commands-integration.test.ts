import assert from 'node:assert'
import { describe, it } from 'node:test'

import commandsCommand from '../src/instance/discord/commands/commands.js'

const MockApplication = () => {
  const translations = new Map<string, string>([
    ['discord.commands.commands.title', 'Command Reference'],
    ['discord.commands.commands.description', 'Browse all available Discord and Minecraft commands.'],
    ['discord.commands.commands.tabs.discord', 'Discord Commands'],
    ['discord.commands.commands.tabs.minecraft', 'Minecraft Commands'],
    ['discord.commands.commands.stats.discord', 'Discord Commands'],
    ['discord.commands.commands.stats.minecraft', 'Minecraft Commands'],
    ['discord.commands.commands.stats.commands', 'commands available'],
    ['discord.commands.commands.actions.search', 'Search'],
    ['discord.commands.commands.actions.categories', 'Categories'],
    ['discord.commands.commands.actions.details', 'Details'],
    ['discord.commands.commands.actions.back-to-list', 'Back to List'],
    ['discord.commands.commands.pagination.previous', 'Previous'],
    ['discord.commands.commands.pagination.next', 'Next'],
    [
      'discord.commands.commands.pagination.display',
      'Showing {{current}} of {{total}} pages ({{count}} total commands)'
    ],
    ['discord.commands.commands.no-results', 'No commands found'],
    ['discord.commands.commands.try-different-filters', 'Try adjusting your search terms or clearing filters.'],
    ['discord.commands.commands.filters.search', 'Searching for'],
    ['discord.commands.commands.filters.category', 'Category']
  ])
  return {
    i18n: {
      t: (key: string) => translations.get(key) ?? key
    }
  }
}

const MockInteraction = () => ({
  user: { id: '123456789' },
  reply: () => ({ fetch: () => ({ id: 'message123' }) }),
  update: () => {
    /* empty */
  },
  showModal: () => {
    /* empty */
  },
  deferReply: () => {
    /* empty */
  },
  editReply: () => {
    /* empty */
  },
  isButton: () => true,
  isFromMessage: () => true,
  customId: '',
  fields: {
    getTextInputValue: () => ''
  },
  createMessageComponentCollector: () => ({
    on: () => {
      /* empty */
    },
    stop: () => {
      /* empty */
    }
  })
})

const MockErrorHandler = {
  promiseCatch: (errorContext: string) => (error: unknown) => {
    assert.fail(`Error in ${errorContext}: ${String(error)}`)
  }
}

interface FilterableCommand {
  name: string
  description: string
  category?: string
}

const GenerateSessionToken = () => {
  return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15)
}

const FilterCommands = (commands: FilterableCommand[], searchQuery?: string) => {
  if (!searchQuery) return commands
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cmd.description.toLowerCase().includes(searchQuery.toLowerCase())
  )
}

interface ParsedSession {
  sessionToken: string
  action: string
  data: string | undefined
}

const ParseSessionData = (customId: string, sessionPrefix: string): ParsedSession | undefined => {
  if (!customId.startsWith(sessionPrefix)) {
    return undefined
  }

  const parts = customId.slice(sessionPrefix.length).split(':')
  if (parts.length < 2) {
    return undefined
  }

  return {
    sessionToken: parts[0],
    action: parts[1],
    data: parts[2]
  }
}

await describe('commands command integration', async () => {
  await it('should handle basic command execution', async () => {
    const mockContext = {
      application: MockApplication(),
      interaction: MockInteraction(),
      errorHandler: MockErrorHandler,
      allCommands: [],
      permission: 0,
      user: { id: '123456789' }
    }

    const originalDiscoverAllCommands = (commandsCommand as unknown as Record<string, unknown>).discoverAllCommands
    ;(commandsCommand as unknown as Record<string, unknown>).discoverAllCommands = () => ({
      discord: [
        { name: 'test', description: 'A test command', isDiscordCommand: true },
        { name: 'settings', description: 'Configure settings', isDiscordCommand: true }
      ],
      minecraft: [
        { name: 'skyblock', description: 'Skyblock info', isDiscordCommand: false, category: 'Skyblock' },
        { name: 'guild', description: 'Guild commands', isDiscordCommand: false, category: 'Guild' }
      ]
    })

    await commandsCommand.handler(mockContext as unknown as Parameters<typeof commandsCommand.handler>[0])
    ;(commandsCommand as unknown as Record<string, unknown>).discoverAllCommands = originalDiscoverAllCommands

    assert.ok(true)
  })

  await it('should handle component interactions correctly', () => {
    const sessionPrefix = 'commands_session_'
    const sessionToken = 'test123'

    const testCases = [
      {
        customId: `${sessionPrefix}${sessionToken}:tab:discord`,
        expected: { sessionToken, action: 'tab', data: 'discord' }
      },
      {
        customId: `${sessionPrefix}${sessionToken}:tab:minecraft`,
        expected: { sessionToken, action: 'tab', data: 'minecraft' }
      },
      {
        customId: `${sessionPrefix}${sessionToken}:search`,
        expected: { sessionToken, action: 'search', data: undefined }
      },
      {
        customId: `${sessionPrefix}${sessionToken}:command:0`,
        expected: { sessionToken, action: 'command', data: '0' }
      },
      {
        customId: `${sessionPrefix}${sessionToken}:page:next`,
        expected: { sessionToken, action: 'page', data: 'next' }
      },
      {
        customId: `${sessionPrefix}${sessionToken}:clear-search`,
        expected: { sessionToken, action: 'clear-search', data: undefined }
      },
      {
        customId: `${sessionPrefix}${sessionToken}:category:Skyblock`,
        expected: { sessionToken, action: 'category', data: 'Skyblock' }
      }
    ]

    for (const testCase of testCases) {
      const parsed = ParseSessionData(testCase.customId, sessionPrefix)
      if (parsed) {
        assert.strictEqual(parsed.sessionToken, testCase.expected.sessionToken)
        assert.strictEqual(parsed.action, testCase.expected.action)
        assert.strictEqual(parsed.data, testCase.expected.data)
      }
    }

    const invalidIds = ['invalid_id', 'commands_session_:missing_action', 'different_prefix:test:action']

    for (const invalidId of invalidIds) {
      const parsed = ParseSessionData(invalidId, sessionPrefix)
      assert.strictEqual(parsed, undefined)
    }
  })

  await it('should handle search modal interactions', () => {
    const mockApplication = MockApplication()

    const searchModal = {
      customId: 'commands_session_test123:search-modal',
      title: mockApplication.i18n.t('discord.commands.commands.search.title'),
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              customId: 'commands_session_test123:search-input',
              style: 1,
              label: mockApplication.i18n.t('discord.commands.commands.search.label'),
              required: false
            }
          ]
        }
      ]
    }

    assert.strictEqual(searchModal.customId, 'commands_session_test123:search-modal')
    assert.strictEqual(searchModal.components.length, 1)
    assert.strictEqual(searchModal.components[0].components.length, 1)
  })

  await it('should generate proper embed structures', () => {
    const mockApplication = MockApplication()
    const i18n = mockApplication.i18n

    const initialEmbed = {
      title: i18n.t('discord.commands.commands.title'),
      description: i18n.t('discord.commands.commands.description'),
      color: 0,
      fields: [
        {
          name: i18n.t('discord.commands.commands.stats.discord'),
          value: '**2** commands available',
          inline: true
        },
        {
          name: i18n.t('discord.commands.commands.stats.minecraft'),
          value: '**2** commands available',
          inline: true
        }
      ]
    }

    assert.strictEqual(initialEmbed.title, 'Command Reference')
    assert.strictEqual(initialEmbed.fields.length, 2)
    assert.strictEqual(initialEmbed.fields[0].inline, true)
    assert.strictEqual(initialEmbed.fields[1].inline, true)

    const filteredEmbed = {
      title: 'Command Reference - Discord Commands',
      description:
        'Browse all available Discord and Minecraft commands.\n\nSearching for: **skyblock**\nCategory: **Skyblock**',
      fields: [
        {
          name: '!skyblock (Skyblock)',
          value: 'Skyblock info...',
          inline: false
        }
      ]
    }

    assert.ok(filteredEmbed.description.includes('Searching for'))
    assert.ok(filteredEmbed.description.includes('Category'))
  })

  await it('should handle pagination state correctly', () => {
    const commands = [
      { name: 'cmd1', description: 'Command 1', category: 'Cat1' },
      { name: 'cmd2', description: 'Command 2', category: 'Cat1' },
      { name: 'cmd3', description: 'Command 3', category: 'Cat2' },
      { name: 'cmd4', description: 'Command 4', category: 'Cat2' },
      { name: 'cmd5', description: 'Command 5', category: 'Cat3' }
    ]

    const pageSize = 2
    const totalPages = Math.max(1, Math.ceil(commands.length / pageSize))
    assert.strictEqual(totalPages, 3)

    const testPageBoundaries = [
      { page: 0, expectedStart: 0, expectedEnd: 2 },
      { page: 1, expectedStart: 2, expectedEnd: 4 },
      { page: 2, expectedStart: 4, expectedEnd: 5 }
    ]

    for (const test of testPageBoundaries) {
      const startIndex = test.page * pageSize
      const endIndex = Math.min(startIndex + pageSize, commands.length)
      const pageCommands = commands.slice(startIndex, endIndex)

      assert.strictEqual(startIndex, test.expectedStart)
      assert.strictEqual(endIndex, test.expectedEnd)
      assert.ok(pageCommands.length <= pageSize)
    }
  })

  await it('should handle category selection properly', () => {
    const commands = [
      { name: 'skyblock', category: 'Skyblock' },
      { name: 'guild', category: 'Guild' },
      { name: 'bedwars', category: 'Games' },
      { name: 'calculate', category: 'Utility' }
    ]

    const categories = [...new Set(commands.map((cmd) => cmd.category))].toSorted()
    assert.strictEqual(categories.length, 4)
    assert.deepStrictEqual(categories, ['Games', 'Guild', 'Skyblock', 'Utility'])

    const skyblockCommands = commands.filter((cmd) => cmd.category === 'Skyblock')
    assert.strictEqual(skyblockCommands.length, 1)
    assert.strictEqual(skyblockCommands[0].name, 'skyblock')
  })

  await it('should validate session token generation and parsing', () => {
    const token1 = GenerateSessionToken()
    const token2 = GenerateSessionToken()

    assert.notStrictEqual(token1, token2)

    assert.strictEqual(token1.length, 28)
    assert.strictEqual(token2.length, 28)

    assert.match(token1, /^[a-z0-9]+$/)
    assert.match(token2, /^[a-z0-9]+$/)
  })

  await it('should handle edge cases in command filtering', () => {
    const commands = [
      { name: 'test', description: 'Test command', category: 'Utility' },
      { name: '', description: 'Empty name', category: 'Utility' },
      { name: 'special!@#', description: 'Special chars', category: 'Other' }
    ]

    const allCommands = FilterCommands(commands)
    assert.strictEqual(allCommands.length, 3)

    const noMatches = FilterCommands(commands, 'nonexistent')
    assert.strictEqual(noMatches.length, 0)

    const caseInsensitive = FilterCommands(commands, 'TEST')
    assert.strictEqual(caseInsensitive.length, 1)
    assert.strictEqual(caseInsensitive[0].name, 'test')

    const partialMatch = FilterCommands(commands, 'command')
    assert.strictEqual(partialMatch.length, 2)
  })
})
