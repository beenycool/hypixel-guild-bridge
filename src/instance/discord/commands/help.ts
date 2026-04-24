import assert from 'node:assert'

import type {
  APIApplicationCommandSubcommandGroupOption,
  APIApplicationCommandSubcommandOption,
  APIEmbed,
  ApplicationCommand,
  Collection
} from 'discord.js'
import { ApplicationCommandOptionType, MessageFlags, SlashCommandBuilder } from 'discord.js'

import { Color, Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { DefaultCommandFooter } from '../common/discord-config.js'
import { pageMessage } from '../utility/discord-pager.js'
import { splitToEmbeds } from '../utility/embed-utilities.js'

export default {
  getCommandBuilder: () => new SlashCommandBuilder().setName('help').setDescription('Show available commands.'),

  handler: async function (context) {
    if (!context.interaction.inGuild()) {
      await context.interaction.reply({ content: 'Use this command only in a server!', flags: MessageFlags.Ephemeral })
      return
    }

    await context.interaction.deferReply()
    assert.ok(context.interaction.inCachedGuild())
    const guildCommands = await context.interaction.guild.commands.fetch()

    const userPermission = context.permission
    const embedBase = {
      title: 'Commands Help',
      description: '',
      color: Color.Default,
      footer: { text: DefaultCommandFooter }
    } satisfies APIEmbed

    const allCommands = context.allCommands

    embedBase.description += '**Anyone**\n'
    embedBase.description += createField(
      guildCommands,
      allCommands.filter((command) => command.permission === undefined || command.permission === Permission.Anyone)
    )
    embedBase.description += '\n'

    if (userPermission >= Permission.Helper) {
      embedBase.description += '**Helper**\n'
      embedBase.description += createField(
        guildCommands,
        allCommands.filter((command) => command.permission === Permission.Helper)
      )
      embedBase.description += '\n'
    }
    if (userPermission >= Permission.Officer) {
      embedBase.description += '**Officer**\n'
      embedBase.description += createField(
        guildCommands,
        allCommands.filter((command) => command.permission === Permission.Officer)
      )
      embedBase.description += '\n'
    }
    if (userPermission >= Permission.Owner) {
      embedBase.description += '**Owner**\n'
      embedBase.description += createField(
        guildCommands,
        allCommands.filter((command) => command.permission === Permission.Owner)
      )
      embedBase.description += '\n'
    }
    if (userPermission >= Permission.Admin) {
      embedBase.description += '**Admin**\n'
      embedBase.description += createField(
        guildCommands,
        allCommands.filter((command) => command.permission === Permission.Admin)
      )
      embedBase.description += '\n'
    }

    const pages = splitToEmbeds(embedBase, embedBase.description)
    await (pages.length <= 1
      ? context.interaction.editReply({ embeds: [pages[0] ?? embedBase] })
      : pageMessage(context.interaction, pages, context.errorHandler))
  }
} satisfies DiscordCommandHandler

function createField(guildCommands: Collection<string, ApplicationCommand>, commands: DiscordCommandHandler[]): string {
  let message = ''
  for (const command of commands) {
    const builder = command.getCommandBuilder()

    const commandName = builder.name
    const commandDescription = builder.description
    const options = builder.options.map((option) => option.toJSON())
    const groupCommands = options.filter((option) => option.type === ApplicationCommandOptionType.SubcommandGroup)
    const subCommands = options.filter((option) => option.type === ApplicationCommandOptionType.Subcommand)

    if (groupCommands.length > 0) {
      message += formatGroupCommand(guildCommands, commandName, commandDescription, groupCommands)
    }
    if (subCommands.length > 0) {
      message += formatSubCommands(guildCommands, [commandName], commandDescription, 0, subCommands)
    }

    if (groupCommands.length === 0 && subCommands.length === 0) {
      message += '- '
      message += formatCommand(guildCommands, [commandName], commandDescription)
      message += '\n'
    }
  }

  return message.trim()
}

function formatGroupCommand(
  guildCommands: Collection<string, ApplicationCommand>,
  commandName: string,
  description: string,
  groupCommands: APIApplicationCommandSubcommandGroupOption[]
): string {
  let message = ''
  message += `${'  '.repeat(0)}- ${description}\n`

  for (const groupCommand of groupCommands) {
    if (groupCommand.options !== undefined && groupCommand.options.length > 0) {
      message += formatSubCommands(
        guildCommands,
        [commandName, groupCommand.name],
        groupCommand.description,
        1,
        groupCommand.options
      )
    }
  }

  return message
}

function formatSubCommands(
  guildCommands: Collection<string, ApplicationCommand>,
  commandName: string[],
  description: string,
  padding: number,
  subCommands: APIApplicationCommandSubcommandOption[]
): string {
  let message = ''
  message += `${'  '.repeat(padding)}- ${description}\n`

  for (const subCommand of subCommands) {
    const subCommandName = subCommand.name
    const subCommandDescription = subCommand.description

    message += `${'  '.repeat(padding + 1)}- `
    message += formatCommand(guildCommands, [...commandName, subCommandName], subCommandDescription)
    message += '\n'
  }

  return message
}

function formatCommand(
  guildCommands: Collection<string, ApplicationCommand>,
  name: string[],
  description: string
): string {
  const commandId = guildCommands.find((guildCommand) => guildCommand.name === name[0])
  return commandId === undefined
    ? `\`/${name.join(' ')}\` ${description}`
    : `</${name.join(' ')}:${commandId.id}> ${description}`
}
