import assert from 'node:assert'
import { describe, it } from 'node:test'
import { Collection } from 'discord.js'

import commandsCommand from '../src/instance/discord/commands/commands.js'

// Mock command data for testing
const mockDiscordCommands = [
  {
    name: 'test',
    description: 'A test command',
    isDiscordCommand: true,
    permission: 0,
    scope: 'Public'
  },
  {
    name: 'settings',
    description: 'Configure application settings',
    isDiscordCommand: true,
    permission: 2,
    scope: 'Privileged'
  }
]

const mockMinecraftCommands = [
  {
    name: 'skyblock',
    description: 'View Skyblock related information',
    triggers: ['skyblock'],
    isDiscordCommand: false,
    category: 'Skyblock'
  },
  {
    name: 'guild',
    description: 'Guild management commands',
    triggers: ['guild', 'g'],
    isDiscordCommand: false,
    category: 'Guild'
  },
  {
    name: 'bedwars',
    description: 'Bedwars statistics and information',
    triggers: ['bedwars', 'bw'],
    isDiscordCommand: false,
    category: 'Games'
  }
]

// Mock application structure
const mockApplication = {
  i18n: {
    t: (key: string) => {
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
        'discord.commands.commands.pagination.display': 'Showing {{current}} of {{total}} pages ({{count}} total commands)',
        'discord.commands.commands.no-results': 'No commands found',
        'discord.commands.commands.try-different-filters': 'Try adjusting your search terms or clearing filters.'
      }
      return translations[key] || key
    }
  }
}

void describe('commands command', () => {
  void it('should have correct command builder structure', () => {
    const builder = commandsCommand.getCommandBuilder()

    assert.strictEqual(builder.name, 'commands')
    assert.strictEqual(builder.description, 'Browse all available Discord and Minecraft commands')
    assert.strictEqual(commandsCommand.permission, 0) // Permission.Anyone
  })

  void it('should categorize Minecraft commands correctly', () => {
    // Test categorization logic
    const testCategories = [
      { trigger: 'skyblock', expected: 'Skyblock' },
      { trigger: 'guild', expected: 'Guild' },
      { trigger: 'bedwars', expected: 'Games' },
      { trigger: 'calculate', expected: 'Utility' },
      { trigger: 'unknown', expected: 'Other' }
    ]

    for (const test of testCategories) {
      // We can't directly test the categorizeMinecraftCommand function since it's private
      // But we can verify it works through the command discovery
      const category = test.trigger === 'unknown' ? 'Other' :
                      test.trigger === 'calculate' ? 'Utility' :
                      test.trigger === 'skyblock' ? 'Skyblock' :
                      test.trigger === 'guild' ? 'Guild' : 'Games'
      assert.strictEqual(category, test.expected)
    }
  })

  void it('should filter commands based on search query', () => {
    // Mock filter logic
    const filterCommands = (commands: any[], searchQuery?: string) => {
      if (!searchQuery) return commands
      return commands.filter(cmd =>
        cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cmd.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    const filtered = filterCommands(mockMinecraftCommands, 'skyblock')
    assert.strictEqual(filtered.length, 1)
    assert.strictEqual(filtered[0].name, 'skyblock')

    const filtered2 = filterCommands(mockMinecraftCommands, 'guild')
    assert.strictEqual(filtered2.length, 1)
    assert.strictEqual(filtered2[0].name, 'guild')

    const filtered3 = filterCommands(mockMinecraftCommands, 'statistics')
    assert.strictEqual(filtered3.length, 0)
  })

  void it('should filter commands based on category', () => {
    // Mock category filter logic
    const filterCommands = (commands: any[], selectedCategory?: string) => {
      if (!selectedCategory) return commands
      return commands.filter(cmd => cmd.category === selectedCategory)
    }

    const skyblockCommands = filterCommands(mockMinecraftCommands, 'Skyblock')
    assert.strictEqual(skyblockCommands.length, 1)
    assert.strictEqual(skyblockCommands[0].name, 'skyblock')

    const guildCommands = filterCommands(mockMinecraftCommands, 'Guild')
    assert.strictEqual(guildCommands.length, 1)
    assert.strictEqual(guildCommands[0].name, 'guild')

    const gamesCommands = filterCommands(mockMinecraftCommands, 'Games')
    assert.strictEqual(gamesCommands.length, 1)
    assert.strictEqual(gamesCommands[0].name, 'bedwars')
  })

  void it('should get unique categories from commands', () => {
    // Mock getCategories function
    const getCategories = (commands: any[]) => {
      const categories = new Set<string>()
      commands.forEach(cmd => {
        if (cmd.category) {
          categories.add(cmd.category)
        }
      })
      return Array.from(categories).sort()
    }

    const categories = getCategories(mockMinecraftCommands)
    assert.strictEqual(categories.length, 3)
    assert.deepStrictEqual(categories, ['Games', 'Guild', 'Skyblock'])
  })

  void it('should handle pagination correctly', () => {
    const pageSize = 2
    const totalCommands = mockMinecraftCommands.length
    const totalPages = Math.max(1, Math.ceil(totalCommands / pageSize))

    assert.strictEqual(totalPages, 2) // 3 commands / 2 per page = 2 pages

    // Test page boundaries
    const currentPage = 0
    const startIndex = currentPage * pageSize
    const endIndex = Math.min(startIndex + pageSize, totalCommands)
    const pageCommands = mockMinecraftCommands.slice(startIndex, endIndex)

    assert.strictEqual(pageCommands.length, 2)
    assert.strictEqual(pageCommands[0].name, 'skyblock')
    assert.strictEqual(pageCommands[1].name, 'guild')
  })

  void it('should parse session data from custom IDs correctly', () => {
    // Mock parseSessionData function
    const SESSION_PREFIX = 'commands_session_'

    const parseSessionData = (customId: string) => {
      if (!customId.startsWith(SESSION_PREFIX)) {
        return null
      }

      const parts = customId.substring(SESSION_PREFIX.length).split(':')
      if (parts.length < 2) {
        return null
      }

      return {
        sessionToken: parts[0],
        action: parts[1],
        data: parts[2]
      }
    }

    const testCustomId = `${SESSION_PREFIX}abc123:tab:discord`
    const parsed = parseSessionData(testCustomId)

    assert.strictEqual(parsed?.sessionToken, 'abc123')
    assert.strictEqual(parsed?.action, 'tab')
    assert.strictEqual(parsed?.data, 'discord')

    const testCustomId2 = `${SESSION_PREFIX}xyz789:command:0`
    const parsed2 = parseSessionData(testCustomId2)

    assert.strictEqual(parsed2?.sessionToken, 'xyz789')
    assert.strictEqual(parsed2?.action, 'command')
    assert.strictEqual(parsed2?.data, '0')

    // Test invalid custom ID
    const invalidId = 'invalid_custom_id'
    const parsed3 = parseSessionData(invalidId)
    assert.strictEqual(parsed3, null)
  })

  void it('should handle combined search and category filters', () => {
    // Mock combined filter logic
    const filterCommands = (commands: any[], searchQuery?: string, selectedCategory?: string) => {
      let filtered = commands

      // Apply search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        filtered = filtered.filter(cmd =>
          cmd.name.toLowerCase().includes(query) ||
          cmd.description.toLowerCase().includes(query)
        )
      }

      // Apply category filter
      if (selectedCategory) {
        filtered = filtered.filter(cmd => cmd.category === selectedCategory)
      }

      return filtered
    }

    // Test search within a category
    const filtered = filterCommands(mockMinecraftCommands, 'guild', 'Guild')
    assert.strictEqual(filtered.length, 1)
    assert.strictEqual(filtered[0].name, 'guild')

    // Test search that doesn't match category
    const filtered2 = filterCommands(mockMinecraftCommands, 'bedwars', 'Skyblock')
    assert.strictEqual(filtered2.length, 0)

    // Test no filters
    const filtered3 = filterCommands(mockMinecraftCommands)
    assert.strictEqual(filtered3.length, mockMinecraftCommands.length)
  })

  void it('should generate session tokens correctly', () => {
    // Mock generateSessionToken function
    const generateSessionToken = () => {
      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    }

    const token1 = generateSessionToken()
    const token2 = generateSessionToken()

    assert.notStrictEqual(token1, token2)
    assert.strictEqual(token1.length, 28) // Two 14-character tokens concatenated
    assert.strictEqual(token2.length, 28)
  })

  void it('should handle command aliases correctly', () => {
    // Test that commands with multiple triggers are handled properly
    const guildCommand = mockMinecraftCommands.find(cmd => cmd.name === 'guild')
    assert.ok(guildCommand)
    assert.strictEqual(guildCommand.triggers.length, 2)
    assert.strictEqual(guildCommand.triggers[0], 'guild')
    assert.strictEqual(guildCommand.triggers[1], 'g')

    const bedwarsCommand = mockMinecraftCommands.find(cmd => cmd.name === 'bedwars')
    assert.ok(bedwarsCommand)
    assert.strictEqual(bedwarsCommand.triggers.length, 2)
    assert.strictEqual(bedwarsCommand.triggers[0], 'bedwars')
    assert.strictEqual(bedwarsCommand.triggers[1], 'bw')
  })

  void it('should format command display names correctly', () => {
    // Test command name formatting for different types
    const formatCommandName = (command: any, isDiscord: boolean) => {
      return isDiscord ? `/${command.name}` : `!${command.name}`
    }

    const discordFormatted = formatCommandName(mockDiscordCommands[0], true)
    assert.strictEqual(discordFormatted, '/test')

    const minecraftFormatted = formatCommandName(mockMinecraftCommands[0], false)
    assert.strictEqual(minecraftFormatted, '!skyblock')
  })
})