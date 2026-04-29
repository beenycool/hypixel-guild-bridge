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
import type EventHelper from './event-helper.js'
import type UnexpectedErrorHandler from './unexpected-error-handler.js'
import type { DiscordUser } from './user'

export abstract class ChatCommandHandler {
  public readonly triggers: string[]
  public readonly description: string
  public readonly example: string

  protected constructor(options: { triggers: string[]; description: string; example: string }) {
    this.triggers = options.triggers
    this.description = options.description
    this.example = options.example
  }

  public getExample(commandPrefix: string): string {
    return `Example: ${commandPrefix}${this.example}`
  }

  public abstract handler(context: ChatCommandContext): Promise<string> | string
}

export interface ChatCommandContext {
  app: Application

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
  /**
   * @default OptionToAddMinecraftInstances.Disabled
   */
  readonly addMinecraftInstancesToOptions?: OptionToAddMinecraftInstances
  /**
   * @default CommandScope.Public
   */
  readonly scope?: CommandScope
  /**
   * @default Permission.Anyone
   */
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
  /**
   * only allow to execute in the registered chat channels
   */
  Chat,
  /**
   * only allow to execute in officer channels
   */
  Privileged,
  /**
   * Allow to execute in any channel anywhere without limitations
   */
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

/**
 * Finds a command by name from a list of commands.
 * @param commands - The list of commands to search
 * @param commandName - The name of the command to find
 * @returns The matching command handler, or undefined if not found
 */
export function findCommandByName(commands: ChatCommandHandler[], commandName: string): ChatCommandHandler | undefined {
  const lowerName = commandName.toLowerCase()
  return commands.find((cmd) => cmd.triggers.some((trigger) => trigger.toLowerCase() === lowerName))
}

/**
 * Formats a command's help text including its triggers and example.
 * @param command - The command to format help text for
 * @param commandPrefix - The command prefix to prepend
 * @param username - Optional username to substitute in the example
 * @returns The formatted help string
 */
export function formatCommandHelp(command: ChatCommandHandler, commandPrefix: string, username?: string): string {
  const example = username ? command.example.replaceAll('%s', username) : command.example
  return `${command.triggers[0]}: ${command.description} (${commandPrefix}${example})`
}

/**
 * Get command suggestions based on a query string, sorted by relevance score.
 * @param commands - The list of commands to search
 * @param query - The search query
 * @param limit - Maximum number of suggestions to return
 * @returns Array of suggestions with command, score, and matching trigger
 */
export function getCommandSuggestions(
  commands: ChatCommandHandler[],
  query: string,
  limit = 3
): { command: ChatCommandHandler; score: number; trigger: string }[] {
  const lowerQuery = query.toLowerCase()
  const suggestions: { command: ChatCommandHandler; score: number; trigger: string }[] = []

  for (const command of commands) {
    for (const trigger of command.triggers) {
      const lowerTrigger = trigger.toLowerCase()

      // Exact match gets highest score
      if (lowerTrigger === lowerQuery) {
        suggestions.push({ command, score: 100, trigger })
        continue
      }

      // Prefix match gets good score
      if (lowerTrigger.startsWith(lowerQuery)) {
        suggestions.push({ command, score: 80 - lowerTrigger.length, trigger })
        continue
      }

      // Contains match gets lower score
      if (lowerTrigger.includes(lowerQuery)) {
        suggestions.push({ command, score: 60 - lowerTrigger.length, trigger })
        continue
      }

      // Levenshtein distance for typo tolerance (simplified)
      const distance = calculateLevenshteinDistance(lowerQuery, lowerTrigger)
      if (distance <= 2) {
        suggestions.push({ command, score: 40 - distance * 10, trigger })
      }
    }
  }

  return suggestions.toSorted((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Get the closest matching command for a query string.
 * @param commands - The list of commands to search
 * @param query - The search query
 * @returns The best matching command with score and trigger, or undefined if no match
 */
export function getClosestCommand(
  commands: ChatCommandHandler[],
  query: string
): { command: ChatCommandHandler; score: number; trigger: string } | undefined {
  const suggestions = getCommandSuggestions(commands, query, 1)
  return suggestions.length > 0 ? suggestions[0] : undefined
}

/**
 * Calculate a similarity score between a query and target string.
 * @param query - The query string to compare
 * @param target - The target string to compare against
 * @returns A similarity score between 0 and 1
 */
export function calculateSimilarityScore(query: string, target: string): number {
  const lowerQuery = query.toLowerCase()
  const lowerTarget = target.toLowerCase()

  // Exact match
  if (lowerQuery === lowerTarget) return 1

  // Prefix match
  if (lowerTarget.startsWith(lowerQuery)) {
    return 0.8 - (lowerTarget.length - lowerQuery.length) * 0.1
  }

  // Contains match
  if (lowerTarget.includes(lowerQuery)) {
    return 0.6 - (lowerTarget.length - lowerQuery.length) * 0.1
  }

  // Levenshtein distance based similarity
  const distance = calculateLevenshteinDistance(lowerQuery, lowerTarget)
  const maxLength = Math.max(lowerQuery.length, lowerTarget.length)
  const similarity = 1 - distance / maxLength

  return Math.max(0, similarity * 0.4) // Max 0.4 for typo matches
}

/**
 * Calculate the Levenshtein distance between two strings.
 * @param string1 - The first string to compare
 * @param string2 - The second string to compare
 * @returns The Levenshtein distance
 */
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
        matrix[index][colIndex - 1] + 1, // deletion
        matrix[index - 1][colIndex] + 1, // insertion
        matrix[index - 1][colIndex - 1] + indicator // substitution
      )
    }
  }

  return matrix[string2.length][string1.length]
}
