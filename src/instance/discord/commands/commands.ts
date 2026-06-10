import fs from 'node:fs'
import path from 'node:path'

import type {
  ActionRowData,
  APIEmbed,
  APIEmbedField,
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionButtonComponentData,
  InteractionResponse,
  MessageActionRowComponentData,
  ModalSubmitInteraction
} from 'discord.js'
import { ButtonStyle, ComponentType, MessageFlags, SlashCommandBuilder, TextInputStyle } from 'discord.js'
import type { Logger } from 'log4js'
import Logger4js from 'log4js'

import type Application from '../../../application.js'
import { Color, Permission } from '../../../common/application-event.js'
import { CommandConfigManager } from '../../../common/command-config-manager.js'
import type { ChatCommandHandler, DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands.js'
import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler.js'
import { DefaultCommandFooter } from '../common/discord-config.js'

const CommandsLogger: Logger = Logger4js.getLogger('Commands')

// Session state management for command custom IDs
const SessionPrefix = 'commands_session_'
const MaxSessionAge = 600_000 // 10 minutes

interface CommandInfo {
  name: string
  originalName?: string // Original command name before any customizations
  description: string
  category?: string
  triggers?: string[] // For Minecraft commands
  isDiscordCommand: boolean
  permission?: Permission
  scope?: string
}

interface SessionState {
  currentTab: 'discord' | 'minecraft'
  currentPage: number
  searchQuery?: string
  selectedCategory?: string
  selectedCommand?: CommandInfo
  timestamp: number
  isAdmin: boolean
  commandConfigManager: CommandConfigManager
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('commands').setDescription('Browse all available Discord and Minecraft commands'),
  permission: Permission.Anyone,

  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { application, interaction, errorHandler } = context

    try {
      // Get command configuration manager
      const commandConfigManager = new CommandConfigManager(application)
      // Check admin permissions
      const isAdmin = context.permission === Permission.Admin

      // Generate session token for state management
      const sessionToken = generateSessionToken()
      const sessionState: SessionState = {
        currentTab: 'discord',
        currentPage: 0,
        timestamp: Date.now(),
        isAdmin,
        commandConfigManager
      }

      // Discover all commands
      const commands = await discoverAllCommands(application, commandConfigManager, isAdmin)

      // Send initial response with tabs
      const reply = await sendInitialResponse(interaction, commands, sessionState, sessionToken, application)

      // Set up component collector
      await setupComponentCollector(interaction, reply, commands, sessionState, sessionToken, application, errorHandler)
    } catch (error) {
      errorHandler.promiseCatch('commands handler')(error)
      await interaction.reply({
        content: 'An error occurred while loading commands. Please try again later.',
        flags: MessageFlags.Ephemeral
      })
    }
  }
} satisfies DiscordCommandHandler

/**
 * Discover all commands dynamically by scanning the directories
 */
async function discoverAllCommands(
  application: Application,
  commandConfigManager: CommandConfigManager,
  isAdmin: boolean
): Promise<{
  discord: CommandInfo[]
  minecraft: CommandInfo[]
}> {
  const discordCommands: CommandInfo[] = []
  const minecraftCommands: CommandInfo[] = []

  try {
    // Discover Discord commands
    const discordCommandsDirectory = path.join(process.cwd(), 'src/instance/discord/commands/')
    const discordFiles = fs
      .readdirSync(discordCommandsDirectory)
      .filter((file) => file.endsWith('.ts') && file !== 'commands.ts')

    for (const file of discordFiles) {
      try {
        const resolvedPath = path.join('../', discordCommandsDirectory, file.replaceAll('.ts', '.js'))
        const importedModule = (await import(resolvedPath)) as {
          default:
            | {
                getCommandBuilder?: () => { name: string; description: string }
                permission?: Permission
                scope?: unknown
              }
            | undefined
        }
        const module = importedModule.default

        if (module?.getCommandBuilder) {
          const builder = module.getCommandBuilder()
          const commandName = builder.name

          // Check if command is disabled (for non-admins)
          if (!isAdmin && !commandConfigManager.isCommandEnabled('discord', commandName)) {
            continue
          }

          // Get custom display name if configured
          const displayName = commandConfigManager.getCommandDisplayName('discord', commandName)

          const commandInfo: CommandInfo = {
            name: displayName,
            originalName: commandName,
            description: builder.description,
            isDiscordCommand: true,
            permission: module.permission,
            scope: module.scope?.toString()
          }
          discordCommands.push(commandInfo)
        }
      } catch (error) {
        CommandsLogger.warn(`Failed to load Discord command from ${file}:`, error)
      }
    }

    // Discover Minecraft commands
    const minecraftCommandsDirectory = path.join(process.cwd(), 'src/instance/commands/triggers/')
    const minecraftFiles = fs.readdirSync(minecraftCommandsDirectory).filter((file) => file.endsWith('.ts'))

    for (const file of minecraftFiles) {
      try {
        const resolvedPath = path.join('../', minecraftCommandsDirectory, file.replaceAll('.ts', '.js'))
        const importedModule = (await import(resolvedPath)) as {
          default:
            | {
                triggers?: string[]
                description?: string
                resolveCommands?: () => ChatCommandHandler[]
              }
            | undefined
        }
        const module = importedModule.default

        if (module?.triggers) {
          // Handle PartyManager which has multiple commands
          if (module.resolveCommands) {
            const resolvedCommands = module.resolveCommands()
            for (const resolvedCommand of resolvedCommands) {
              const commandTrigger = resolvedCommand.triggers[0]

              // Check if command is disabled (for non-admins)
              if (!isAdmin && !commandConfigManager.isCommandEnabled('minecraft', commandTrigger)) {
                continue
              }

              // Get custom display name if configured
              const displayName = commandConfigManager.getCommandDisplayName('minecraft', commandTrigger)

              const commandInfo: CommandInfo = {
                name: displayName,
                originalName: commandTrigger,
                description: resolvedCommand.description,
                triggers: resolvedCommand.triggers,
                isDiscordCommand: false,
                category: categorizeMinecraftCommand(commandTrigger)
              }
              minecraftCommands.push(commandInfo)
            }
          } else {
            // Regular ChatCommandHandler
            const commandTrigger = module.triggers[0]

            // Check if command is disabled (for non-admins)
            if (!isAdmin && !commandConfigManager.isCommandEnabled('minecraft', commandTrigger)) {
              continue
            }

            // Get custom display name if configured
            const displayName = commandConfigManager.getCommandDisplayName('minecraft', commandTrigger)

            const commandInfo: CommandInfo = {
              name: displayName,
              originalName: commandTrigger,
              description: module.description ?? '',
              triggers: module.triggers,
              isDiscordCommand: false,
              category: categorizeMinecraftCommand(commandTrigger)
            }
            minecraftCommands.push(commandInfo)
          }
        }
      } catch (error) {
        CommandsLogger.warn(`Failed to load Minecraft command from ${file}:`, error)
      }
    }
  } catch (error) {
    CommandsLogger.error('Error discovering commands:', error)
  }

  return { discord: discordCommands, minecraft: minecraftCommands }
}

/**
 * Categorize Minecraft commands based on their triggers
 */
function categorizeMinecraftCommand(trigger: string): string {
  const categories: Record<string, string[]> = {
    ['Skyblock']: [
      'skyblock',
      'collection',
      'bestiary',
      'skills',
      'slayer',
      'networth',
      'purse',
      'weight',
      'sblevel',
      'catacomb',
      'kuudra',
      'trophyfish',
      'fairysouls',
      'garden',
      'essence',
      'magicalpower',
      'secrets'
    ],
    ['Guild']: [
      'guild',
      'guildexp',
      'promote',
      'demote',
      'kick',
      'invite',
      'requirements',
      'join',
      'leave',
      'online',
      'offline',
      'officer'
    ],
    ['Games']: [
      'bedwars',
      'duels',
      'skywars',
      'uhc',
      'blitz',
      'buildbattle',
      'murdermystery',
      'paintball',
      'tntgames',
      'tnttag',
      'smash',
      'megawalls',
      'speeduhc',
      'woolwars',
      'party'
    ],
    ['Utility']: [
      'calculate',
      'rng',
      '8ball',
      'unscramble',
      'quickmath',
      'level',
      'status',
      'timecharms',
      'starfall',
      'mayor',
      'election',
      'special-mayors',
      'dojo',
      'crimson'
    ],
    ['Other']: []
  }

  for (const [category, triggers] of Object.entries(categories)) {
    if (triggers.includes(trigger)) {
      return category
    }
  }
  return 'Other'
}

/**
 * Send the initial response with tab selection
 */
async function sendInitialResponse(
  interaction: ChatInputCommandInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  application: Application
): Promise<InteractionResponse> {
  const i18n = application.i18n

  const embed: APIEmbed = {
    title: i18n.t(($) => $['discord.commands.commands.title']),
    description: i18n.t(($) => $['discord.commands.commands.description']),
    color: Color.Default,
    fields: [
      {
        name: i18n.t(($) => $['discord.commands.commands.stats.discord']),
        value: `**${commands.discord.length}** ${i18n.t(($) => $['discord.commands.commands.stats.commands'])}`,
        inline: true
      },
      {
        name: i18n.t(($) => $['discord.commands.commands.stats.minecraft']),
        value: `**${commands.minecraft.length}** ${i18n.t(($) => $['discord.commands.commands.stats.commands'])}`,
        inline: true
      }
    ],
    footer: { text: DefaultCommandFooter }
  }

  return await interaction.reply({
    embeds: [embed],
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            customId: `${SessionPrefix}${sessionToken}:tab:discord`,
            label: i18n.t(($) => $['discord.commands.commands.tabs.discord']),
            style: ButtonStyle.Primary,
            emoji: '💬'
          },
          {
            type: ComponentType.Button,
            customId: `${SessionPrefix}${sessionToken}:tab:minecraft`,
            label: i18n.t(($) => $['discord.commands.commands.tabs.minecraft']),
            style: ButtonStyle.Secondary,
            emoji: '⛏️'
          },
          {
            type: ComponentType.Button,
            customId: `${SessionPrefix}${sessionToken}:search`,
            label: i18n.t(($) => $['discord.commands.commands.actions.search']),
            style: ButtonStyle.Secondary,
            emoji: '🔍'
          },
          {
            type: ComponentType.Button,
            customId: `${SessionPrefix}${sessionToken}:categories`,
            label: i18n.t(($) => $['discord.commands.commands.actions.categories']),
            style: ButtonStyle.Secondary,
            emoji: '📂'
          }
        ]
      }
    ],
    flags: MessageFlags.IsComponentsV2
  })
}

/**
 * Generate a unique session token
 */
function generateSessionToken(): string {
  return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15)
}

/**
 * Parse session token and state from custom ID
 */
function parseSessionData(customId: string): { sessionToken: string; action: string; data?: string } | undefined {
  if (!customId.startsWith(SessionPrefix)) {
    return undefined
  }

  const parts = customId.slice(SessionPrefix.length).split(':')
  if (parts.length < 2) {
    return undefined
  }

  return {
    sessionToken: parts[0],
    action: parts[1],
    data: parts[2]
  }
}

/**
 * Filter and paginate commands based on current state
 */
function filterCommands(commands: CommandInfo[], sessionState: SessionState): CommandInfo[] {
  let filtered = commands

  // Apply search filter
  if (sessionState.searchQuery) {
    const query = sessionState.searchQuery.toLowerCase()
    filtered = filtered.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query) ||
        cmd.triggers?.some((trigger) => trigger.toLowerCase().includes(query))
    )
  }

  // Apply category filter
  if (sessionState.selectedCategory) {
    filtered = filtered.filter((cmd) => cmd.category === sessionState.selectedCategory)
  }

  return filtered
}

/**
 * Get unique categories from commands
 */
function getCategories(commands: CommandInfo[]): string[] {
  const categories = new Set<string>()
  for (const cmd of commands) {
    if (cmd.category) {
      categories.add(cmd.category)
    }
  }
  return [...categories].toSorted()
}

/**
 * Set up component interaction collector
 */
async function setupComponentCollector(
  interaction: ChatInputCommandInteraction,
  reply: InteractionResponse,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  application: Application,
  errorHandler: UnexpectedErrorHandler
) {
  const replyId = await reply.fetch().then((message) => message.id)
  const collector = reply.createMessageComponentCollector({
    filter: (messageInteraction) =>
      messageInteraction.user.id === interaction.user.id && messageInteraction.message.id === replyId,
    time: MaxSessionAge
  })

  collector.on('collect', (messageInteraction) => {
    ;(async () => {
      try {
        const sessionData = parseSessionData(messageInteraction.customId)
        if (sessionData?.sessionToken !== sessionToken) {
          return
        }

        // Handle different interaction types
        if (messageInteraction.isButton()) {
          await handleButtonInteraction(
            messageInteraction,
            commands,
            sessionState,
            sessionToken,
            application,
            errorHandler
          )
        } else if (messageInteraction.isModalSubmit()) {
          await handleModalSubmit(messageInteraction, commands, sessionState, sessionToken, application, errorHandler)
        }
      } catch (error) {
        errorHandler.promiseCatch('commands component interaction')(error)
      }
    })().catch((error: unknown) => {
      errorHandler.promiseCatch('commands component interaction')(error)
    })
  })

  collector.on('end', () => {
    // Session expired, disable components
    reply.edit({ components: [] }).catch(() => {
      /* session expired, ignore edit failure */
    })
  })
}

/**
 * Handle button interactions
 */
async function handleButtonInteraction(
  interaction: ButtonInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  application: Application,
  errorHandler: UnexpectedErrorHandler
) {
  void errorHandler
  const sessionData = parseSessionData(interaction.customId)
  if (!sessionData) return

  switch (sessionData.action) {
    case 'tab': {
      if (sessionData.data === 'discord' || sessionData.data === 'minecraft') {
        sessionState.currentTab = sessionData.data
        sessionState.currentPage = 0
        await updateCommandList(interaction, commands, sessionState, sessionToken, application)
      }
      break
    }

    case 'search': {
      await showSearchModal(interaction, sessionState, sessionToken, application)
      break
    }

    case 'categories': {
      await showCategorySelector(interaction, commands, sessionState, sessionToken, application)
      break
    }

    case 'page': {
      if (sessionData.data === 'prev') {
        sessionState.currentPage = Math.max(0, sessionState.currentPage - 1)
      } else if (sessionData.data === 'next') {
        sessionState.currentPage++
      }
      await updateCommandList(interaction, commands, sessionState, sessionToken, application)
      break
    }

    case 'command': {
      if (sessionData.data) {
        const commandIndex = Number.parseInt(sessionData.data, 10)
        await showCommandDetails(interaction, commands, sessionState, sessionToken, commandIndex, application)
      }
      break
    }

    case 'clear-search': {
      sessionState.searchQuery = undefined
      sessionState.currentPage = 0
      await updateCommandList(interaction, commands, sessionState, sessionToken, application)
      break
    }

    case 'clear-category': {
      sessionState.selectedCategory = undefined
      sessionState.currentPage = 0
      await updateCommandList(interaction, commands, sessionState, sessionToken, application)
      break
    }

    case 'category': {
      if (sessionData.data) {
        sessionState.selectedCategory = sessionData.data
        sessionState.currentPage = 0
        await updateCommandList(interaction, commands, sessionState, sessionToken, application)
      }
      break
    }

    case 'back-to-list': {
      await updateCommandList(interaction, commands, sessionState, sessionToken, application)
      break
    }

    // Admin actions
    case 'admin-rename': {
      if (sessionState.isAdmin && sessionData.data) {
        const commandIndex = Number.parseInt(sessionData.data, 10)
        await showRenameModal(interaction, commands, sessionState, sessionToken, commandIndex, application)
      }
      break
    }

    case 'admin-toggle': {
      if (sessionState.isAdmin && sessionData.data) {
        const commandIndex = Number.parseInt(sessionData.data, 10)
        await toggleCommand(interaction, commands, sessionState, sessionToken, commandIndex, application)
      }
      break
    }

    case 'admin-audit': {
      if (sessionState.isAdmin && sessionData.data) {
        const commandIndex = Number.parseInt(sessionData.data, 10)
        await showAuditLog(interaction, commands, sessionState, sessionToken, commandIndex, application)
      }
      break
    }

    case 'admin-confirm-disable': {
      if (sessionState.isAdmin && sessionData.data) {
        const commandIndex = Number.parseInt(sessionData.data, 10)
        await confirmDisableCommand(interaction, commands, sessionState, sessionToken, commandIndex, application)
      }
      break
    }
  }
}

/**
 * Update the command list display
 */
async function updateCommandList(
  interaction: ButtonInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  application: Application
) {
  const i18n = application.i18n
  const currentCommands = sessionState.currentTab === 'discord' ? commands.discord : commands.minecraft
  const filteredCommands = filterCommands(currentCommands, sessionState)

  const pageSize = 8
  const totalPages = Math.max(1, Math.ceil(filteredCommands.length / pageSize))
  const startIndex = sessionState.currentPage * pageSize
  const endIndex = Math.min(startIndex + pageSize, filteredCommands.length)
  const currentPageCommands = filteredCommands.slice(startIndex, endIndex)

  const embed: APIEmbed = {
    title: i18n.t(
      ($) =>
        $['discord.commands.commands.title'] +
        ` - ${i18n.t(($) =>
          sessionState.currentTab === 'discord'
            ? $['discord.commands.commands.tabs.discord']
            : $['discord.commands.commands.tabs.minecraft']
        )}`
    ),
    description:
      i18n.t(($) => $['discord.commands.commands.description']) +
      (sessionState.searchQuery
        ? `\n\n${i18n.t(($) => $['discord.commands.commands.filters.search'])}: **${sessionState.searchQuery}**`
        : '') +
      (sessionState.selectedCategory
        ? `\n${i18n.t(($) => $['discord.commands.commands.filters.category'])}: **${sessionState.selectedCategory}**`
        : ''),
    color: Color.Default,
    footer: { text: DefaultCommandFooter }
  }

  const embedFields: APIEmbedField[] = []

  // Add commands to embed
  for (const cmd of currentPageCommands) {
    const displayName = sessionState.currentTab === 'discord' ? `/${cmd.name}` : `!${cmd.name}`
    embedFields.push({
      name: `${displayName} ${cmd.category ? `(${cmd.category})` : ''}`,
      value: cmd.description.slice(0, 100) + (cmd.description.length > 100 ? '...' : ''),
      inline: false
    })
  }

  if (filteredCommands.length === 0) {
    embedFields.push({
      name: i18n.t(($) => $['discord.commands.commands.no-results']),
      value: i18n.t(($) => $['discord.commands.commands.try-different-filters']),
      inline: false
    })
  }

  // Pagination info
  embedFields.push({
    name: i18n.t(($) => $['discord.commands.commands.pagination.info']),
    value: i18n.t(($) => $['discord.commands.commands.pagination.display'], {
      current: sessionState.currentPage + 1,
      total: totalPages,
      count: filteredCommands.length
    }),
    inline: false
  })

  embed.fields = embedFields

  // Create components
  const components: ActionRowData<MessageActionRowComponentData>[] = []

  // Tab buttons
  components.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        customId: `${SessionPrefix}${sessionToken}:tab:discord`,
        label: i18n.t(($) => $['discord.commands.commands.tabs.discord']),
        style: sessionState.currentTab === 'discord' ? ButtonStyle.Primary : ButtonStyle.Secondary,
        emoji: '💬'
      },
      {
        type: ComponentType.Button,
        customId: `${SessionPrefix}${sessionToken}:tab:minecraft`,
        label: i18n.t(($) => $['discord.commands.commands.tabs.minecraft']),
        style: sessionState.currentTab === 'minecraft' ? ButtonStyle.Primary : ButtonStyle.Secondary,
        emoji: '⛏️'
      },
      {
        type: ComponentType.Button,
        customId: `${SessionPrefix}${sessionToken}:search`,
        label: i18n.t(($) => $['discord.commands.commands.actions.search']),
        style: ButtonStyle.Secondary,
        emoji: '🔍'
      },
      {
        type: ComponentType.Button,
        customId: `${SessionPrefix}${sessionToken}:categories`,
        label: i18n.t(($) => $['discord.commands.commands.actions.categories']),
        style: ButtonStyle.Secondary,
        emoji: '📂'
      }
    ]
  })

  // Command buttons (for detail view)
  if (currentPageCommands.length > 0) {
    const commandButtons: InteractionButtonComponentData[] = []
    for (let commandButtonIndex = 0; commandButtonIndex < currentPageCommands.length; commandButtonIndex++) {
      const commandIndex = startIndex + commandButtonIndex
      commandButtons.push({
        type: ComponentType.Button,
        customId: `${SessionPrefix}${sessionToken}:command:${commandIndex}`,
        label: i18n.t(($) => $['discord.commands.commands.actions.details']),
        style: ButtonStyle.Secondary,
        emoji: '📋'
      })
    }

    // Split into rows of 5 buttons max
    for (let rowIndex = 0; rowIndex < commandButtons.length; rowIndex += 5) {
      components.push({
        type: ComponentType.ActionRow,
        components: commandButtons.slice(rowIndex, rowIndex + 5)
      })
    }
  }

  // Pagination controls
  if (totalPages > 1) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          customId: `${SessionPrefix}${sessionToken}:page:prev`,
          label: i18n.t(($) => $['discord.commands.commands.pagination.previous']),
          style: ButtonStyle.Secondary,
          disabled: sessionState.currentPage === 0,
          emoji: '⬅️'
        },
        {
          type: ComponentType.Button,
          customId: `${SessionPrefix}${sessionToken}:page:next`,
          label: i18n.t(($) => $['discord.commands.commands.pagination.next']),
          style: ButtonStyle.Secondary,
          disabled: sessionState.currentPage >= totalPages - 1,
          emoji: '➡️'
        }
      ]
    })
  }

  // Clear filters buttons
  if (sessionState.searchQuery || sessionState.selectedCategory) {
    const filterButtons: InteractionButtonComponentData[] = []
    if (sessionState.searchQuery) {
      filterButtons.push({
        type: ComponentType.Button,
        customId: `${SessionPrefix}${sessionToken}:clear-search`,
        label: i18n.t(($) => $['discord.commands.commands.actions.clear-search']),
        style: ButtonStyle.Danger,
        emoji: '❌'
      })
    }
    if (sessionState.selectedCategory) {
      filterButtons.push({
        type: ComponentType.Button,
        customId: `${SessionPrefix}${sessionToken}:clear-category`,
        label: i18n.t(($) => $['discord.commands.commands.actions.clear-category']),
        style: ButtonStyle.Danger,
        emoji: '🗂️'
      })
    }

    if (filterButtons.length > 0) {
      components.push({
        type: ComponentType.ActionRow,
        components: filterButtons
      })
    }
  }

  await interaction.update({
    embeds: [embed],
    components,
    flags: MessageFlags.IsComponentsV2
  })
}

/**
 * Show search modal
 */
async function showSearchModal(
  interaction: ButtonInteraction,
  sessionState: SessionState,
  sessionToken: string,
  application: Application
) {
  const i18n = application.i18n
  await interaction.showModal({
    customId: `${SessionPrefix}${sessionToken}:search-modal`,
    title: i18n.t(($) => $['discord.commands.commands.search.title']),
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            customId: `${SessionPrefix}${sessionToken}:search-input`,
            label: i18n.t(($) => $['discord.commands.commands.search.label']),
            style: TextInputStyle.Short,
            required: false,
            value: sessionState.searchQuery ?? undefined
          }
        ]
      }
    ]
  })

  // Wait for modal submission
  interaction
    .awaitModalSubmit({
      time: 300_000,
      filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id
    })
    .then((modalInteraction) => {
      const value = modalInteraction.fields.getTextInputValue(`${SessionPrefix}${sessionToken}:search-input`).trim()
      sessionState.searchQuery = value.length === 0 ? undefined : value
      sessionState.currentPage = 0
      // Update the display (modal from message has update)
      if (modalInteraction.isFromMessage()) {
        modalInteraction.update({ components: [] }).catch(() => {
          /* modal cleanup, ignore failure */
        })
      }
    })
    .catch(() => {
      /* modal timed out or cancelled */
    })
}

/**
 * Show category selector
 */
async function showCategorySelector(
  interaction: ButtonInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  application: Application
) {
  const i18n = application.i18n
  const currentCommands = sessionState.currentTab === 'discord' ? commands.discord : commands.minecraft
  const categories = getCategories(currentCommands)

  if (categories.length === 0) {
    await interaction.reply({
      content: i18n.t(($) => $['discord.commands.commands.no-categories']),
      flags: MessageFlags.Ephemeral
    })
    return
  }

  const embed: APIEmbed = {
    title: i18n.t(($) => $['discord.commands.commands.categories.title']),
    description: i18n.t(($) => $['discord.commands.commands.categories.description']),
    color: Color.Default,
    fields: [],
    footer: { text: DefaultCommandFooter }
  }

  for (const category of categories) {
    const count = currentCommands.filter((cmd) => cmd.category === category).length
    embed.fields?.push({
      name: `${category} (${count})`,
      value: i18n.t(($) => $['discord.commands.commands.categories.select'], { category }),
      inline: false
    })
  }

  const categoryButtons: InteractionButtonComponentData[] = categories.map((category) => ({
    type: ComponentType.Button,
    customId: `${SessionPrefix}${sessionToken}:category:${category}`,
    label: category,
    style: sessionState.selectedCategory === category ? ButtonStyle.Primary : ButtonStyle.Secondary
  }))

  // Split into rows of 3 buttons max
  const components: ActionRowData<MessageActionRowComponentData>[] = []
  for (let catIndex = 0; catIndex < categoryButtons.length; catIndex += 3) {
    components.push({
      type: ComponentType.ActionRow,
      components: categoryButtons.slice(catIndex, catIndex + 3)
    })
  }

  await interaction.update({
    embeds: [embed],
    components,
    flags: MessageFlags.IsComponentsV2
  })
}

/**
 * Show detailed command information
 */
async function showCommandDetails(
  interaction: ButtonInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  commandIndex: number,
  application: Application
) {
  const i18n = application.i18n
  const currentCommands = sessionState.currentTab === 'discord' ? commands.discord : commands.minecraft
  const filteredCommands = filterCommands(currentCommands, sessionState)
  if (commandIndex >= filteredCommands.length) {
    await interaction.reply({
      content: i18n.t(($) => $['discord.commands.commands.command-not-found']),
      flags: MessageFlags.Ephemeral
    })
    return
  }

  const command = filteredCommands[commandIndex]

  const embedFields: APIEmbedField[] = []

  const embed: APIEmbed = {
    title: sessionState.currentTab === 'discord' ? `/${command.name}` : `!${command.name}`,
    description: command.description,
    color: Color.Default,
    fields: embedFields,
    footer: { text: DefaultCommandFooter }
  }

  if (command.category !== undefined) {
    embedFields.push({
      name: i18n.t(($) => $['discord.commands.commands.details.category']),
      value: command.category,
      inline: true
    })
  }

  if (command.triggers !== undefined && command.triggers.length > 1) {
    embedFields.push({
      name: i18n.t(($) => $['discord.commands.commands.details.aliases']),
      value: command.triggers
        .slice(1)
        .map((t) => `!${t}`)
        .join(', '),
      inline: true
    })
  }

  if (command.permission !== undefined) {
    embedFields.push({
      name: i18n.t(($) => $['discord.commands.commands.details.permission']),
      value: command.permission.toString(),
      inline: true
    })
  }

  // Show command status and custom name for admins
  if (sessionState.isAdmin) {
    const commandType = command.isDiscordCommand ? 'discord' : 'minecraft'
    const commandIdentifier = command.originalName ?? command.name
    const isEnabled = sessionState.commandConfigManager.isCommandEnabled(commandType, commandIdentifier)
    const customName = sessionState.commandConfigManager.getCommandDisplayName(commandType, commandIdentifier)
    const isCustomName = customName !== commandIdentifier

    embedFields.push({
      name: i18n.t(($) => $['discord.commands.commands.details.status']),
      value: isEnabled
        ? i18n.t(($) => $['discord.commands.commands.details.enabled'])
        : i18n.t(($) => $['discord.commands.commands.details.disabled']),
      inline: true
    })

    if (isCustomName) {
      embedFields.push({
        name: i18n.t(($) => $['discord.commands.commands.details.custom-name']),
        value: customName,
        inline: true
      })
    }

    const components: ActionRowData<MessageActionRowComponentData>[] = [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            customId: `${SessionPrefix}${sessionToken}:back-to-list`,
            label: i18n.t(($) => $['discord.commands.commands.actions.back-to-list']),
            style: ButtonStyle.Secondary,
            emoji: '⬅️'
          }
        ]
      }
    ]

    // Add admin buttons if user is admin
    const adminButtons: InteractionButtonComponentData[] = []

    // Rename button
    adminButtons.push({
      type: ComponentType.Button,
      customId: `${SessionPrefix}${sessionToken}:admin-rename:${commandIndex}`,
      label: i18n.t(($) => $['discord.commands.commands.admin.rename.button']),
      style: ButtonStyle.Primary,
      emoji: '✏️'
    })

    // Toggle enable/disable button
    const toggleIsEnabled = sessionState.commandConfigManager.isCommandEnabled(
      command.isDiscordCommand ? 'discord' : 'minecraft',
      command.originalName ?? command.name
    )
    adminButtons.push({
      type: ComponentType.Button,
      customId: `${SessionPrefix}${sessionToken}:admin-toggle:${commandIndex}`,
      label: toggleIsEnabled
        ? i18n.t(($) => $['discord.commands.commands.admin.toggle.disable'])
        : i18n.t(($) => $['discord.commands.commands.admin.toggle.enable']),
      style: toggleIsEnabled ? ButtonStyle.Danger : ButtonStyle.Success,
      emoji: toggleIsEnabled ? '🚫' : '✅'
    })

    // Audit log button
    adminButtons.push({
      type: ComponentType.Button,
      customId: `${SessionPrefix}${sessionToken}:admin-audit:${commandIndex}`,
      label: i18n.t(($) => $['discord.commands.commands.admin.audit.title']),
      style: ButtonStyle.Secondary,
      emoji: '📋'
    })

    // Split admin buttons into rows of 3
    for (let admIndex = 0; admIndex < adminButtons.length; admIndex += 3) {
      components.push({
        type: ComponentType.ActionRow,
        components: adminButtons.slice(admIndex, admIndex + 3)
      })
    }

    await interaction.update({
      embeds: [embed],
      components,
      flags: MessageFlags.IsComponentsV2
    })
  } else {
    await interaction.update({
      embeds: [embed],
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              customId: `${SessionPrefix}${sessionToken}:back-to-list`,
              label: i18n.t(($) => $['discord.commands.commands.actions.back-to-list']),
              style: ButtonStyle.Secondary,
              emoji: '⬅️'
            }
          ]
        }
      ],
      flags: MessageFlags.IsComponentsV2
    })
  }
}

/**
 * Handle modal submissions from the collector (if any)
 */
async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  application: Application,
  errorHandler: UnexpectedErrorHandler
) {
  void commands
  void sessionState
  void sessionToken
  void application
  void errorHandler
  // Modals are usually not caught by MessageComponentCollector, but kept for compatibility if needed.
  await interaction.deferUpdate()
}

async function showRenameModal(
  interaction: ButtonInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  commandIndex: number,
  application: Application
) {
  const i18n = application.i18n
  const currentCommands = sessionState.currentTab === 'discord' ? commands.discord : commands.minecraft
  const filteredCommands = filterCommands(currentCommands, sessionState)
  if (commandIndex >= filteredCommands.length) return

  const command = filteredCommands[commandIndex]

  const modalId = `${SessionPrefix}${sessionToken}:admin-rename-submit:${commandIndex}`

  await interaction.showModal({
    customId: modalId,
    title: i18n.t(($) => $['discord.commands.commands.admin.rename.modal.title']),
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            customId: `${SessionPrefix}${sessionToken}:rename-input`,
            label: i18n.t(($) => $['discord.commands.commands.admin.rename.modal.label']),
            style: TextInputStyle.Short,
            value: command.name,
            placeholder: i18n.t(($) => $['discord.commands.commands.admin.rename.modal.placeholder'])
          }
        ]
      }
    ]
  })

  // Await the modal submit
  try {
    const submit = await interaction.awaitModalSubmit({
      time: 60_000,
      filter: (modalSubmitInteraction) =>
        modalSubmitInteraction.customId === modalId && modalSubmitInteraction.user.id === interaction.user.id
    })

    const newName = submit.fields.getTextInputValue(`${SessionPrefix}${sessionToken}:rename-input`)
    const commandType = command.isDiscordCommand ? 'discord' : 'minecraft'
    const identifier = command.originalName ?? command.name

    if (commandType === 'discord') {
      sessionState.commandConfigManager.updateDiscordCommandConfig(
        identifier,
        { displayName: newName },
        interaction.user.id
      )
    } else {
      sessionState.commandConfigManager.updateMinecraftCommandConfig(
        identifier,
        { displayName: newName },
        interaction.user.id
      )
    }

    sessionState.commandConfigManager.addAuditLogEntry({
      action: 'rename',
      commandType: commandType,
      commandIdentifier: identifier,
      oldValue: command.name,
      newValue: newName,
      userId: interaction.user.id
    })

    // Refresh the list - ModalSubmitInteraction can be treated as ButtonInteraction for updateCommandList
    await updateCommandList(submit as unknown as ButtonInteraction, commands, sessionState, sessionToken, application)
  } catch {
    // Modal timed out or error
  }
}

async function toggleCommand(
  interaction: ButtonInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  commandIndex: number,
  application: Application
) {
  const currentCommands = sessionState.currentTab === 'discord' ? commands.discord : commands.minecraft
  const filteredCommands = filterCommands(currentCommands, sessionState)
  if (commandIndex >= filteredCommands.length) return
  const command = filteredCommands[commandIndex]

  const commandType = command.isDiscordCommand ? 'discord' : 'minecraft'
  const identifier = command.originalName ?? command.name
  const isEnabled = sessionState.commandConfigManager.isCommandEnabled(commandType, identifier)

  if (commandType === 'discord') {
    sessionState.commandConfigManager.updateDiscordCommandConfig(
      identifier,
      { enabled: !isEnabled },
      interaction.user.id
    )
  } else {
    sessionState.commandConfigManager.updateMinecraftCommandConfig(
      identifier,
      { enabled: !isEnabled },
      interaction.user.id
    )
  }

  sessionState.commandConfigManager.addAuditLogEntry({
    action: isEnabled ? 'disable' : 'enable',
    commandType: commandType,
    commandIdentifier: identifier,
    userId: interaction.user.id
  })

  await showCommandDetails(interaction, commands, sessionState, sessionToken, commandIndex, application)
}

async function showAuditLog(
  interaction: ButtonInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  commandIndex: number,
  application: Application
) {
  const i18n = application.i18n
  // Placeholder
  await interaction.reply({
    content: i18n.t(($) => $['discord.commands.commands.admin.audit.empty']),
    flags: MessageFlags.Ephemeral
  })
}

async function confirmDisableCommand(
  interaction: ButtonInteraction,
  commands: { discord: CommandInfo[]; minecraft: CommandInfo[] },
  sessionState: SessionState,
  sessionToken: string,
  commandIndex: number,
  application: Application
) {
  // Direct toggle for now
  await toggleCommand(interaction, commands, sessionState, sessionToken, commandIndex, application)
}
