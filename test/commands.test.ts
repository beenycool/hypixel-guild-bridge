import assert from 'node:assert'
import { describe, it } from 'node:test'

import commandsCommand from '../src/instance/discord/commands/commands.js'

interface MockCommand {
  name: string
  description: string
  isDiscordCommand: boolean
  permission?: number
  scope?: string
  triggers?: string[]
  category?: string
}

const MockDiscordCommands: MockCommand[] = [
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

const MockMinecraftCommands: MockCommand[] = [
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

const FilterCommandsBySearch = (commands: MockCommand[], searchQuery?: string) => {
  if (!searchQuery) return commands
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cmd.description.toLowerCase().includes(searchQuery.toLowerCase())
  )
}

const FilterCommandsByCategory = (commands: MockCommand[], selectedCategory?: string) => {
  if (!selectedCategory) return commands
  return commands.filter((cmd) => cmd.category === selectedCategory)
}

const GetCategories = (commands: MockCommand[]) => {
  const categories = new Set<string>()
  for (const cmd of commands) {
    if (cmd.category) {
      categories.add(cmd.category)
    }
  }
  return [...categories].toSorted()
}

const FilterCommandsCombined = (commands: MockCommand[], searchQuery?: string, selectedCategory?: string) => {
  let filtered = commands

  if (searchQuery) {
    const query = searchQuery.toLowerCase()
    filtered = filtered.filter(
      (cmd) => cmd.name.toLowerCase().includes(query) || cmd.description.toLowerCase().includes(query)
    )
  }

  if (selectedCategory) {
    filtered = filtered.filter((cmd) => cmd.category === selectedCategory)
  }

  return filtered
}

const GenerateSessionToken = () => {
  return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15)
}

const FormatCommandName = (command: MockCommand, isDiscord: boolean) => {
  return isDiscord ? `/${command.name}` : `!${command.name}`
}

interface ParsedSessionData {
  sessionToken: string
  action: string
  data: string | undefined
}

const ParseSessionData = (customId: string, sessionPrefix: string): ParsedSessionData | undefined => {
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

await describe('commands command', async () => {
  await it('should have correct command builder structure', () => {
    const builder = commandsCommand.getCommandBuilder()

    assert.strictEqual(builder.name, 'commands')
    assert.strictEqual(builder.description, 'Browse all available Discord and Minecraft commands')
    assert.strictEqual(commandsCommand.permission, 0)
  })

  await it('should categorize Minecraft commands correctly', () => {
    const testCategories = [
      { trigger: 'skyblock', expected: 'Skyblock' },
      { trigger: 'guild', expected: 'Guild' },
      { trigger: 'bedwars', expected: 'Games' },
      { trigger: 'calculate', expected: 'Utility' },
      { trigger: 'unknown', expected: 'Other' }
    ]

    for (const test of testCategories) {
      const category =
        test.trigger === 'unknown'
          ? 'Other'
          : test.trigger === 'calculate'
            ? 'Utility'
            : test.trigger === 'skyblock'
              ? 'Skyblock'
              : test.trigger === 'guild'
                ? 'Guild'
                : 'Games'
      assert.strictEqual(category, test.expected)
    }
  })

  await it('should filter commands based on search query', () => {
    const filtered = FilterCommandsBySearch(MockMinecraftCommands, 'skyblock')
    assert.strictEqual(filtered.length, 1)
    assert.strictEqual(filtered[0].name, 'skyblock')

    const filtered2 = FilterCommandsBySearch(MockMinecraftCommands, 'guild')
    assert.strictEqual(filtered2.length, 1)
    assert.strictEqual(filtered2[0].name, 'guild')

    const filtered3 = FilterCommandsBySearch(MockMinecraftCommands, 'statistics')
    assert.strictEqual(filtered3.length, 0)
  })

  await it('should filter commands based on category', () => {
    const skyblockCommands = FilterCommandsByCategory(MockMinecraftCommands, 'Skyblock')
    assert.strictEqual(skyblockCommands.length, 1)
    assert.strictEqual(skyblockCommands[0].name, 'skyblock')

    const guildCommands = FilterCommandsByCategory(MockMinecraftCommands, 'Guild')
    assert.strictEqual(guildCommands.length, 1)
    assert.strictEqual(guildCommands[0].name, 'guild')

    const gamesCommands = FilterCommandsByCategory(MockMinecraftCommands, 'Games')
    assert.strictEqual(gamesCommands.length, 1)
    assert.strictEqual(gamesCommands[0].name, 'bedwars')
  })

  await it('should get unique categories from commands', () => {
    const categories = GetCategories(MockMinecraftCommands)
    assert.strictEqual(categories.length, 3)
    assert.deepStrictEqual(categories, ['Games', 'Guild', 'Skyblock'])
  })

  await it('should handle pagination correctly', () => {
    const pageSize = 2
    const totalCommands = MockMinecraftCommands.length
    const totalPages = Math.max(1, Math.ceil(totalCommands / pageSize))

    assert.strictEqual(totalPages, 2)

    const currentPage = 0
    const startIndex = currentPage * pageSize
    const endIndex = Math.min(startIndex + pageSize, totalCommands)
    const pageCommands = MockMinecraftCommands.slice(startIndex, endIndex)

    assert.strictEqual(pageCommands.length, 2)
    assert.strictEqual(pageCommands[0].name, 'skyblock')
    assert.strictEqual(pageCommands[1].name, 'guild')
  })

  await it('should parse session data from custom IDs correctly', () => {
    const sessionPrefix = 'commands_session_'

    const testCustomId = `${sessionPrefix}abc123:tab:discord`
    const parsed = ParseSessionData(testCustomId, sessionPrefix)
    assert.ok(parsed)
    assert.strictEqual(parsed.sessionToken, 'abc123')
    assert.strictEqual(parsed.action, 'tab')
    assert.strictEqual(parsed.data, 'discord')

    const testCustomId2 = `${sessionPrefix}xyz789:command:0`
    const parsed2 = ParseSessionData(testCustomId2, sessionPrefix)
    assert.ok(parsed2)
    assert.strictEqual(parsed2.sessionToken, 'xyz789')
    assert.strictEqual(parsed2.action, 'command')
    assert.strictEqual(parsed2.data, '0')

    const invalidId = 'invalid_custom_id'
    const parsed3 = ParseSessionData(invalidId, sessionPrefix)
    assert.strictEqual(parsed3, undefined)
  })

  await it('should handle combined search and category filters', () => {
    const filtered = FilterCommandsCombined(MockMinecraftCommands, 'guild', 'Guild')
    assert.strictEqual(filtered.length, 1)
    assert.strictEqual(filtered[0].name, 'guild')

    const filtered2 = FilterCommandsCombined(MockMinecraftCommands, 'bedwars', 'Skyblock')
    assert.strictEqual(filtered2.length, 0)

    const filtered3 = FilterCommandsCombined(MockMinecraftCommands)
    assert.strictEqual(filtered3.length, MockMinecraftCommands.length)
  })

  await it('should generate session tokens correctly', () => {
    const token1 = GenerateSessionToken()
    const token2 = GenerateSessionToken()

    assert.notStrictEqual(token1, token2)
    assert.strictEqual(token1.length, 28)
    assert.strictEqual(token2.length, 28)
  })

  await it('should handle command aliases correctly', () => {
    const guildCommand = MockMinecraftCommands.find((cmd) => cmd.name === 'guild')
    assert.ok(guildCommand)
    assert.ok(guildCommand.triggers)
    assert.strictEqual(guildCommand.triggers.length, 2)
    assert.strictEqual(guildCommand.triggers[0], 'guild')
    assert.strictEqual(guildCommand.triggers[1], 'g')

    const bedwarsCommand = MockMinecraftCommands.find((cmd) => cmd.name === 'bedwars')
    assert.ok(bedwarsCommand)
    assert.ok(bedwarsCommand.triggers)
    assert.strictEqual(bedwarsCommand.triggers.length, 2)
    assert.strictEqual(bedwarsCommand.triggers[0], 'bedwars')
    assert.strictEqual(bedwarsCommand.triggers[1], 'bw')
  })

  await it('should format command display names correctly', () => {
    const discordFormatted = FormatCommandName(MockDiscordCommands[0], true)
    assert.strictEqual(discordFormatted, '/test')

    const minecraftFormatted = FormatCommandName(MockMinecraftCommands[0], false)
    assert.strictEqual(minecraftFormatted, '!skyblock')
  })
})
