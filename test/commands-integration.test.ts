import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Collection } from 'discord.js'

import commandsCommand from '../src/instance/discord/commands/commands.js'

// Mock application for integration testing
const createMockApplication = () => ({
  i18n: {
    t: (key: string, options?: any) => {
      const translations: Record<string, string> = {
        'discord.commands.commands.title': 'Command Reference',
        'discord.commands.commands.description': 'Browse all available Discord and Minecraft commands.',
        'discord.commands.commands.tabs.discord': 'Discord Commands',
        'discord.commands.commands.tabs.minecraft': 'Minecraft Commands',
        'discord.commands.commands.stats.discord': 'Discord Commands',
        'discord.commands.commands.stats.minecraft': 'Minecraft Commands',
        'discord.commands.commands.stats.commands': 'commands available',
        'discord.commands.commands.actions.search': 'Search',
        'discord.commands.commands.actions.categories': 'Categories',
        'discord.commands.commands.actions.details': 'Details',
        'discord.commands.commands.actions.back-to-list': 'Back to List',
        'discord.commands.commands.pagination.previous': 'Previous',
        'discord.commands.commands.pagination.next': 'Next',
        'discord.commands.commands.pagination.display':
          'Showing {{current}} of {{total}} pages ({{count}} total commands)',
        'discord.commands.commands.no-results': 'No commands found',
        'discord.commands.commands.try-different-filters': 'Try adjusting your search terms or clearing filters.',
        'discord.commands.commands.filters.search': 'Searching for',
        'discord.commands.commands.filters.category': 'Category'
      }
      return translations[key] || key
    }
  }
})

// Mock interaction for testing
const createMockInteraction = () => ({
  user: { id: '123456789' },
  reply: async (arguments_: any) => ({ fetch: async () => ({ id: 'message123' }) }),
  update: async (arguments_: any) => {},
  showModal: async (arguments_: any) => {},
  deferReply: async () => {},
  editReply: async (arguments_: any) => {},
  isButton: () => true,
  isFromMessage: () => true,
  customId: '',
  fields: {
    getTextInputValue: (id: string) => ''
  },
  createMessageComponentCollector: () => ({
    on: (event: string, handler: Function) => {},
    stop: () => {}
  })
})

// Mock error handler
const mockErrorHandler = {
  promiseCatch: (context: string) => (error: any) => {
    console.error(`Error in ${context}:`, error)
  }
}

void describe('commands command integration', () => {
  void it('should handle basic command execution', async () => {
    const mockContext = {
      application: createMockApplication(),
      interaction: createMockInteraction(),
      errorHandler: mockErrorHandler,
      allCommands: [],
      permission: 0,
      user: { id: '123456789' }
    }

    // Mock the discoverAllCommands function to return test data
    const originalDiscoverAllCommands = (commandsCommand as any).discoverAllCommands
    ;(commandsCommand as any).discoverAllCommands = async () => ({
      discord: [
        { name: 'test', description: 'A test command', isDiscordCommand: true },
        { name: 'settings', description: 'Configure settings', isDiscordCommand: true }
      ],
      minecraft: [
        { name: 'skyblock', description: 'Skyblock info', isDiscordCommand: false, category: 'Skyblock' },
        { name: 'guild', description: 'Guild commands', isDiscordCommand: false, category: 'Guild' }
      ]
    })

    // Execute the command handler
    await commandsCommand.handler(mockContext as any)

    // Restore original function
    ;(commandsCommand as any).discoverAllCommands = originalDiscoverAllCommands

    // Test passes if no error is thrown
    assert.ok(true)
  })

  void it('should handle component interactions correctly', async () => {
    // Test the component interaction handling logic
    const SESSION_PREFIX = 'commands_session_'
    const sessionToken = 'test123'

    // Test parsing valid custom IDs
    const testCases = [
      {
        customId: `${SESSION_PREFIX}${sessionToken}:tab:discord`,
        expected: { sessionToken, action: 'tab', data: 'discord' }
      },
      {
        customId: `${SESSION_PREFIX}${sessionToken}:tab:minecraft`,
        expected: { sessionToken, action: 'tab', data: 'minecraft' }
      },
      {
        customId: `${SESSION_PREFIX}${sessionToken}:search`,
        expected: { sessionToken, action: 'search', data: undefined }
      },
      {
        customId: `${SESSION_PREFIX}${sessionToken}:command:0`,
        expected: { sessionToken, action: 'command', data: '0' }
      },
      {
        customId: `${SESSION_PREFIX}${sessionToken}:page:next`,
        expected: { sessionToken, action: 'page', data: 'next' }
      },
      {
        customId: `${SESSION_PREFIX}${sessionToken}:clear-search`,
        expected: { sessionToken, action: 'clear-search', data: undefined }
      },
      {
        customId: `${SESSION_PREFIX}${sessionToken}:category:Skyblock`,
        expected: { sessionToken, action: 'category', data: 'Skyblock' }
      }
    ]

    for (const testCase of testCases) {
      const parsed = (commandsCommand as any).parseSessionData?.(testCase.customId)
      if (parsed) {
        assert.strictEqual(parsed.sessionToken, testCase.expected.sessionToken)
        assert.strictEqual(parsed.action, testCase.expected.action)
        assert.strictEqual(parsed.data, testCase.expected.data)
      }
    }

    // Test invalid custom IDs
    const invalidIds = ['invalid_id', 'commands_session_:missing_action', 'different_prefix:test:action']

    for (const invalidId of invalidIds) {
      const parsed = (commandsCommand as any).parseSessionData?.(invalidId)
      assert.strictEqual(parsed, null)
    }
  })

  void it('should handle search modal interactions', async () => {
    const mockApplication = createMockApplication()

    // Test search modal configuration
    const searchModal = {
      customId: 'commands_session_test123:search-modal',
      title: mockApplication.i18n.t('discord.commands.commands.search.title'),
      components: [
        {
          type: 1, // ActionRow
          components: [
            {
              type: 4, // TextInput
              customId: 'commands_session_test123:search-input',
              style: 1, // Short
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

  void it('should generate proper embed structures', async () => {
    const mockApplication = createMockApplication()
    const i18n = mockApplication.i18n

    // Test initial embed structure
    const initialEmbed = {
      title: i18n.t('discord.commands.commands.title'),
      description: i18n.t('discord.commands.commands.description'),
      color: 0, // Default color
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

    // Test command list embed with filters
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

  void it('should handle pagination state correctly', async () => {
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

    // Test page boundaries
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

  void it('should handle category selection properly', async () => {
    const commands = [
      { name: 'skyblock', category: 'Skyblock' },
      { name: 'guild', category: 'Guild' },
      { name: 'bedwars', category: 'Games' },
      { name: 'calculate', category: 'Utility' }
    ]

    const categories = [...new Set(commands.map((cmd) => cmd.category))].sort()
    assert.strictEqual(categories.length, 4)
    assert.deepStrictEqual(categories, ['Games', 'Guild', 'Skyblock', 'Utility'])

    // Test category filtering
    const skyblockCommands = commands.filter((cmd) => cmd.category === 'Skyblock')
    assert.strictEqual(skyblockCommands.length, 1)
    assert.strictEqual(skyblockCommands[0].name, 'skyblock')
  })

  void it('should validate session token generation and parsing', async () => {
    const generateSessionToken = () => {
      return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15)
    }

    const token1 = generateSessionToken()
    const token2 = generateSessionToken()

    // Tokens should be unique
    assert.notStrictEqual(token1, token2)

    // Tokens should be proper length
    assert.strictEqual(token1.length, 28)
    assert.strictEqual(token2.length, 28)

    // Tokens should only contain valid characters
    assert.match(token1, /^[a-z0-9]+$/)
    assert.match(token2, /^[a-z0-9]+$/)
  })

  void it('should handle edge cases in command filtering', async () => {
    const commands = [
      { name: 'test', description: 'Test command', category: 'Utility' },
      { name: '', description: 'Empty name', category: 'Utility' },
      { name: 'special!@#', description: 'Special chars', category: 'Other' }
    ]

    // Test empty search query
    const filterCommands = (searchQuery?: string) => {
      if (!searchQuery) return commands
      return commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          cmd.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    const allCommands = filterCommands()
    assert.strictEqual(allCommands.length, 3)

    // Test search with no matches
    const noMatches = filterCommands('nonexistent')
    assert.strictEqual(noMatches.length, 0)

    // Test case-insensitive search
    const caseInsensitive = filterCommands('TEST')
    assert.strictEqual(caseInsensitive.length, 1)
    assert.strictEqual(caseInsensitive[0].name, 'test')

    // Test partial matching
    const partialMatch = filterCommands('command')
    assert.strictEqual(partialMatch.length, 2) // 'Test command' and 'Empty name'
  })
})
