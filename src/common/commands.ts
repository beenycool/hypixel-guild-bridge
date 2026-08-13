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

export abstract class ChatCommandHandler {
  public readonly triggers: string[]
  public readonly description: string
  public readonly example: string
  public readonly category: string

  protected constructor(options: { triggers: string[]; description: string; example: string; category?: string }) {
    this.triggers = options.triggers
    this.description = options.description
    this.example = options.example
    this.category = options.category ?? 'General'
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
 *
 * The output is capped to stay well below the 256 character Minecraft chat
 * limit (plus /msg metadata): aliases are dropped first, then the example is
 * truncated as a last resort.
 * @param command - The command to format help text for
 * @param commandPrefix - The command prefix to prepend
 * @param username - Optional username to substitute in the example
 * @returns The formatted help string
 */
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

  const MaxHelpLength = 200
  const message = build(true)
  if (message.length <= MaxHelpLength) return message

  const messageWithoutAliases = build(false)
  if (messageWithoutAliases.length <= MaxHelpLength) return messageWithoutAliases

  return `${messageWithoutAliases.slice(0, MaxHelpLength - 3)}...`
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
 *
 * The score is used both for ranking suggestions and for enforcing the typo
 * suggestion threshold, so ranking and threshold always agree.
 * @param query - The query string to compare
 * @param target - The target string to compare against
 * @returns A similarity score between 0 and 1, or 0 when there is no meaningful match
 */
export function calculateSimilarityScore(query: string, target: string): number {
  const lowerQuery = query.toLowerCase().trim()
  const lowerTarget = target.toLowerCase().trim()

  // Exact match
  if (lowerQuery === lowerTarget) return 1

  // Too short to be a meaningful partial or typo match
  if (lowerQuery.length < 2) return 0

  // Prefix match
  if (lowerTarget.startsWith(lowerQuery)) return 0.85

  // Damerau-Levenshtein distance (transpositions count as a single edit)
  const distance = calculateDamerauLevenshteinDistance(lowerQuery, lowerTarget)
  const minLength = Math.min(lowerQuery.length, lowerTarget.length)
  const maxLength = Math.max(lowerQuery.length, lowerTarget.length)

  // Adaptive edit budget: longer words tolerate more edits, short ones almost none
  const budget = 1 + Math.floor(minLength / 4)
  if (distance > budget) return 0

  // Length-normalized edit score penalized by length mismatch
  const lengthRatio = minLength / maxLength
  return (1 - distance / maxLength) * lengthRatio
}

/**
 * Calculate the Damerau-Levenshtein distance between two strings (optimal string alignment).
 * @param string1 - The first string to compare
 * @param string2 - The second string to compare
 * @returns The minimum number of insertions, deletions, substitutions and adjacent transpositions
 */
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
        matrix[index][colIndex - 1] + 1, // deletion
        matrix[index - 1][colIndex] + 1, // insertion
        matrix[index - 1][colIndex - 1] + indicator // substitution
      )

      // Adjacent transposition (e.g. "hlep" -> "help") counts as a single edit
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
