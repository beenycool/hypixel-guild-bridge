import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js'
import type { Logger } from 'log4js'

import type Application from '../application.js'

import type { ChatEvent, InstanceType, Permission } from './application-event.js'
import type { CommandApiCache } from './command-api-cache.js'
import type EventHelper from './event-helper.js'
import type UnexpectedErrorHandler from './unexpected-error-handler.js'
import type { DiscordUser } from './user'

export interface CommandSubcommand {
  readonly name: string
  readonly description: string
  readonly example: string
}

export abstract class ChatCommandHandler {
  public readonly triggers: string[]
  public readonly description: string
  public readonly example: string
  public readonly category: string
  public readonly subcommands: CommandSubcommand[] | undefined

  protected constructor(options: {
    triggers: string[]
    description: string
    example: string
    category?: string
    subcommands?: CommandSubcommand[]
  }) {
    this.triggers = options.triggers
    this.description = options.description
    this.example = options.example
    this.category = options.category ?? 'General'
    this.subcommands = options.subcommands
  }

  public getExample(commandPrefix: string): string {
    return `Example: ${commandPrefix}${this.example}`
  }

  public abstract handler(context: ChatCommandContext): Promise<string> | string
}

export interface ChatCommandContext {
  app: Application

  apiCache: CommandApiCache

  eventHelper: EventHelper<InstanceType.Commands>
  logger: Logger
  errorHandler: UnexpectedErrorHandler

  allCommands: ChatCommandHandler[]
  commandPrefix: string

  message: ChatEvent
  username: string
  args: string[]

  sendFeedback: (feedback: string) => Promise<void>
}

export interface DiscordCommandHandler {
  readonly getCommandBuilder: () =>
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder

  readonly addMinecraftInstancesToOptions?: OptionToAddMinecraftInstances

  readonly scope?: CommandScope

  readonly permission?: Permission

  readonly handler: (context: Readonly<DiscordCommandContext>) => Promise<void>
  readonly autoComplete?: (context: Readonly<DiscordAutoCompleteContext>) => Promise<void>
}

export enum OptionToAddMinecraftInstances {
  Disabled,
  Optional,
  Required
}

export enum CommandScope {
  Chat,

  Privileged,

  Anywhere
}

interface DiscordContext {
  application: Application
  eventHelper: EventHelper<InstanceType.Discord>
  logger: Logger
  instanceName: string

  user: DiscordUser
  permission: Permission
  errorHandler: UnexpectedErrorHandler

  allCommands: DiscordCommandHandler[]
  bridgeId?: string
}

export interface DiscordCommandContext extends DiscordContext {
  interaction: ChatInputCommandInteraction
  showPermissionDenied: (requiredPermission: Exclude<Permission, Permission.Anyone>) => Promise<void>
}

export interface DiscordAutoCompleteContext extends DiscordContext {
  interaction: AutocompleteInteraction
}

export function findCommandByName(commands: ChatCommandHandler[], commandName: string): ChatCommandHandler | undefined {
  const lowerName = commandName.toLowerCase()
  return commands.find((cmd) => cmd.triggers.some((trigger) => trigger.toLowerCase() === lowerName))
}

export function formatCommandHelp(command: ChatCommandHandler, commandPrefix: string, username?: string): string {
  const example = username ? command.example.replaceAll('%s', username) : command.example
  const build = (withAliases: boolean): string => {
    let aliasSuffix = ''
    if (withAliases) {
      const aliases = command.triggers.slice(1, 6)
      if (aliases.length > 0) {
        const overflow = command.triggers.length > aliases.length + 1 ? ', ...' : ''
        aliasSuffix = ` (aliases: ${aliases.join(', ')}${overflow})`
      }
    }
    return `[${command.category}] ${command.triggers[0]}: ${command.description}${aliasSuffix} - Example: ${commandPrefix}${example}`
  }
  const appendSubcommands = (base: string): string => {
    if (command.subcommands === undefined || command.subcommands.length === 0) return base

    const separator = ' - subcommands: '
    const names = command.subcommands.map((subcommand) => subcommand.name)
    let list = names.join(', ')
    if (base.length + separator.length + list.length <= MaxHelpLength) return base + separator + list

    const budget = Math.max(0, MaxHelpLength - base.length - separator.length - 3)
    while (list.length > budget && names.length > 0) {
      names.pop()
      list = names.join(', ')
    }
    return base + separator + list + '...'
  }

  const MaxHelpLength = 200
  const message = build(true)
  if (message.length <= MaxHelpLength) return appendSubcommands(message)

  const messageWithoutAliases = build(false)
  if (messageWithoutAliases.length <= MaxHelpLength) return appendSubcommands(messageWithoutAliases)

  return `${appendSubcommands(messageWithoutAliases).slice(0, MaxHelpLength - 3)}...`
}

export function formatSubcommandHelp(
  command: ChatCommandHandler,
  subcommandName: string,
  commandPrefix: string,
  username?: string
): string | undefined {
  const subcommand = command.subcommands?.find((candidate) => candidate.name === subcommandName)
  if (subcommand === undefined) return undefined

  const example = username ? subcommand.example.replaceAll('%s', username) : subcommand.example
  return `[${command.category}] ${command.triggers[0]} ${subcommand.name}: ${subcommand.description} - Example: ${commandPrefix}${example}`
}

export function getCommandSuggestions(
  commands: ChatCommandHandler[],
  query: string,
  limit = 3
): { command: ChatCommandHandler; score: number; trigger: string }[] {
  const suggestions: { command: ChatCommandHandler; score: number; trigger: string }[] = []

  for (const command of commands) {
    for (const trigger of command.triggers) {
      const score = calculateSimilarityScore(query, trigger)
      if (score > 0) {
        suggestions.push({ command, score, trigger })
      }
    }
  }

  return suggestions.toSorted((a, b) => b.score - a.score).slice(0, limit)
}

export function getClosestCommand(
  commands: ChatCommandHandler[],
  query: string
): { command: ChatCommandHandler; score: number; trigger: string } | undefined {
  const suggestions = getCommandSuggestions(commands, query, 1)
  return suggestions.length > 0 ? suggestions[0] : undefined
}

export function calculateSimilarityScore(query: string, target: string): number {
  const lowerQuery = query.toLowerCase().trim()
  const lowerTarget = target.toLowerCase().trim()

  if (lowerQuery === lowerTarget) return 1

  if (lowerQuery.length < 2) return 0

  if (lowerTarget.startsWith(lowerQuery)) return 0.85

  const distance = calculateDamerauLevenshteinDistance(lowerQuery, lowerTarget)
  const minLength = Math.min(lowerQuery.length, lowerTarget.length)
  const maxLength = Math.max(lowerQuery.length, lowerTarget.length)

  const budget = 1 + Math.floor(minLength / 4)
  if (distance > budget) return 0

  const lengthRatio = minLength / maxLength
  return (1 - distance / maxLength) * lengthRatio
}

export function calculateDamerauLevenshteinDistance(string1: string, string2: string): number {
  const length1 = string1.length
  const length2 = string2.length

  if (length1 === 0) return length2
  if (length2 === 0) return length1

  const matrix: number[][] = Array.from({ length: length1 + 1 }, () => Array.from({ length: length2 + 1 }, () => 0))
  for (let index = 0; index <= length1; index++) matrix[index][0] = index
  for (let index = 0; index <= length2; index++) matrix[0][index] = index

  for (let index = 1; index <= length1; index++) {
    for (let colIndex = 1; colIndex <= length2; colIndex++) {
      const indicator = string1[index - 1] === string2[colIndex - 1] ? 0 : 1
      matrix[index][colIndex] = Math.min(
        matrix[index][colIndex - 1] + 1,
        matrix[index - 1][colIndex] + 1,
        matrix[index - 1][colIndex - 1] + indicator
      )

      if (
        index > 1 &&
        colIndex > 1 &&
        string1[index - 1] === string2[colIndex - 2] &&
        string1[index - 2] === string2[colIndex - 1]
      ) {
        matrix[index][colIndex] = Math.min(matrix[index][colIndex], matrix[index - 2][colIndex - 2] + 1)
      }
    }
  }

  return matrix[length1][length2]
}

export function calculateLevenshteinDistance(string1: string, string2: string): number {
  const matrix: number[][] = Array.from({ length: string2.length + 1 }, () =>
    Array.from({ length: string1.length + 1 }, () => 0)
  )

  for (let index = 0; index <= string1.length; index++) matrix[0][index] = index
  for (let index = 0; index <= string2.length; index++) matrix[index][0] = index

  for (let index = 1; index <= string2.length; index++) {
    for (let colIndex = 1; colIndex <= string1.length; colIndex++) {
      const indicator = string1[colIndex - 1] === string2[index - 1] ? 0 : 1
      matrix[index][colIndex] = Math.min(
        matrix[index][colIndex - 1] + 1,
        matrix[index - 1][colIndex] + 1,
        matrix[index - 1][colIndex - 1] + indicator
      )
    }
  }

  return matrix[string2.length][string1.length]
}
