import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler, formatCommandHelp, getCommandSuggestions } from '../../../common/commands.js'

const MaxLineLength = 120
const MaxPageLength = 170

export function listCategories(commands: ChatCommandHandler[], disabledCommands: string[]): string[] {
  const categories = new Set<string>()
  for (const command of commands) {
    if (isDisabled(command, disabledCommands)) continue
    categories.add(command.category)
  }
  return [...categories].toSorted()
}

export function searchCommandsByKeyword(
  commands: ChatCommandHandler[],
  query: string,
  limit = 10
): ChatCommandHandler[] {
  const lowerQuery = query.toLowerCase()
  const matches = commands.filter(
    (command) =>
      command.triggers.some((trigger) => trigger.toLowerCase().includes(lowerQuery)) ||
      command.description.toLowerCase().includes(lowerQuery) ||
      command.category.toLowerCase().includes(lowerQuery)
  )
  return matches.toSorted((a, b) => a.triggers[0].localeCompare(b.triggers[0])).slice(0, limit)
}

export function buildCommandLines(commands: ChatCommandHandler[], disabledCommands: string[]): string[] {
  const grouped = new Map<string, string[]>()
  for (const command of commands) {
    if (isDisabled(command, disabledCommands)) continue
    const names = grouped.get(command.category) ?? []
    names.push(command.triggers[0])
    grouped.set(command.category, names)
  }

  const lines: string[] = []
  for (const category of [...grouped.keys()].toSorted()) {
    let line = `${category}: `
    const names = (grouped.get(category) ?? []).toSorted()
    for (const name of names) {
      if (line.length + name.length + 2 > MaxLineLength) {
        lines.push(line.trimEnd())
        line = `${category}: `
      }
      line += `${name}, `
    }
    lines.push(line.slice(0, -2))
  }
  return lines
}

export function paginateLines(lines: string[], maxPageLength = MaxPageLength): string[][] {
  const pages: string[][] = []
  let currentPage: string[] = []
  let pageLength = 0
  for (const line of lines) {
    const separatorLength = currentPage.length > 0 ? 3 : 0
    if (currentPage.length > 0 && pageLength + separatorLength + line.length > maxPageLength) {
      pages.push(currentPage)
      currentPage = []
      pageLength = 0
    }
    currentPage.push(line)
    pageLength += (currentPage.length > 1 ? 3 : 0) + line.length
  }
  if (currentPage.length > 0) pages.push(currentPage)
  return pages
}

function isDisabled(command: ChatCommandHandler, disabledCommands: string[]): boolean {
  return command.triggers.some((trigger) => disabledCommands.includes(trigger.toLowerCase()))
}

export default class Help extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Utility',
      triggers: ['help', 'command', 'commands', 'cmd', 'cmds'],
      description: 'Shows available command categories and how to use commands',
      example: `help [category/command/page]`
    })
  }

  handler(context: ChatCommandContext): string {
    const argument = context.args.length > 0 ? context.args[0] : undefined
    const pageArgument = context.args[1]
    const page = /^\d+$/g.test(pageArgument) ? Number.parseInt(pageArgument, 10) : undefined

    if (argument === undefined) return this.showCategories(context)
    if (/^\d+$/g.test(argument)) return this.showAllCommands(context, Number.parseInt(argument, 10))

    const query = argument.toLowerCase()

    const command = context.allCommands.find((c) => c.triggers.includes(query))
    if (command != undefined) return formatCommandHelp(command, context.commandPrefix, context.username)

    const categoryCommands = this.availableCommands(context).filter((c) => c.category.toLowerCase() === query)
    if (categoryCommands.length > 0) return this.showCategoryCommands(context, categoryCommands, query, page)

    const matches = searchCommandsByKeyword(context.allCommands, query)
    if (matches.length > 0) {
      const names = matches.map((c) => c.triggers[0])
      const overflow = names.length >= 10 ? '...' : ''
      return `Commands matching "${argument}": ${names.join(', ')}${overflow}`
    }

    const suggestions = getCommandSuggestions(context.allCommands, query, 3)
    if (suggestions.length > 0) {
      return `Command "${argument}" does not exist. Did you mean ${suggestions.map((s) => s.trigger).join(', ')}?`
    }

    return `Command "${argument}" does not exist. Use ${context.commandPrefix}help to list all categories.`
  }

  private availableCommands(context: ChatCommandContext): ChatCommandHandler[] {
    const disabledCommands = context.app.core.commandsConfigurations.getDisabledCommands()
    return context.allCommands.filter((command) => !isDisabled(command, disabledCommands))
  }

  private showCategories(context: ChatCommandContext): string {
    const categories = listCategories(
      context.allCommands,
      context.app.core.commandsConfigurations.getDisabledCommands()
    )
    if (categories.length === 0) return 'No commands are available.'

    const lines = paginateLines([`Categories: ${categories.join(', ')}`])
    return `Commands - ${context.commandPrefix}help <category> for details: ${lines[0].join(' | ')}`
  }

  private showCategoryCommands(
    context: ChatCommandContext,
    categoryCommands: ChatCommandHandler[],
    category: string,
    page: number | undefined
  ): string {
    const lines = buildCommandLines(categoryCommands, context.app.core.commandsConfigurations.getDisabledCommands())
    const pages = paginateLines(lines)
    const pageIndex = Math.max(Math.min(page ?? 1, pages.length), 1)

    const header = `[${categoryCommands[0].category}] (page ${pageIndex} of ${pages.length}) - ${context.commandPrefix}help <command> for details:`
    return `${header} ${pages[pageIndex - 1].join(' | ')}`
  }

  private showAllCommands(context: ChatCommandContext, page: number): string {
    const lines = buildCommandLines(context.allCommands, context.app.core.commandsConfigurations.getDisabledCommands())
    const pages = paginateLines(lines)
    if (pages.length === 0) return 'No commands are available.'

    const pageIndex = Math.max(Math.min(page, pages.length), 1)
    return `Commands (page ${pageIndex} of ${pages.length}) - ${context.commandPrefix}help <command> for details: ${pages[pageIndex - 1].join(' | ')}`
  }
}
