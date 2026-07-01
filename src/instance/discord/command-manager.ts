import assert from 'node:assert'

import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  RESTPostAPIChatInputApplicationCommandsJSONBody
} from 'discord.js'
import { Collection, DiscordAPIError, escapeMarkdown, MessageFlags, REST, Routes } from 'discord.js'

import { ChannelType, Color, InstanceType, Permission } from '../../common/application-event.js'
import type { DiscordAutoCompleteContext, DiscordCommandContext, DiscordCommandHandler } from '../../common/commands.js'
import { CommandScope, OptionToAddMinecraftInstances } from '../../common/commands.js'
import SubInstance from '../../common/sub-instance'
import Duration from '../../utility/duration'
import { setTimeoutAsync } from '../../utility/scheduling'

import AcceptCommand from './commands/accept.js'
import BlacklistCommand from './commands/blacklist.js'
import DashboardCommand from './commands/dashboard.js'
import DisconnectCommand from './commands/disconnect.js'
import ExecuteCommand from './commands/execute.js'
import InviteCommand from './commands/invite.js'
import JoinCommand from './commands/join.js'
import ListCommand from './commands/list.js'
import LogCommand from './commands/log.js'
import RankCommand from './commands/rank.js'
import ReconnectCommand from './commands/reconnect.js'
import RestartCommand from './commands/restart.js'
import {
  getBridgeMinecraftInstanceNames,
  getConnectedBridgeMinecraftInstanceNames
} from './common/bridge-minecraft-instances.js'
import { DefaultCommandFooter } from './common/discord-config.js'
import { translateNoPermission } from './common/discord-language'
import type DiscordInstance from './discord-instance.js'

export class CommandManager extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  readonly commands = new Collection<string, DiscordCommandHandler>()

  constructor(clientInstance: DiscordInstance) {
    super(clientInstance)
    this.addDefaultCommands()
  }

  override registerEvents(client: Client): void {
    let listenerStarted = false
    client.on('clientReady', (client) => {
      if (listenerStarted) return
      listenerStarted = true
      this.listenToRegisterCommands(client)
    })

    client.on('interactionCreate', (interaction) => {
      if (interaction.isChatInputCommand()) {
        void this.onCommand(interaction).catch(
          this.errorHandler.promiseCatch('handling incoming ChatInputCommand event')
        )
      } else if (interaction.isAutocomplete()) {
        void this.onAutoComplete(interaction).catch(
          this.errorHandler.promiseCatch('handling incoming autocomplete event')
        )
      }
    })
    this.logger.trace('CommandManager is registered')
  }

  private listenToRegisterCommands(client: Client<true>): void {
    const timeoutId = setTimeoutAsync(() => this.registerDiscordCommand(client), {
      delay: Duration.seconds(5),
      errorHandler: this.errorHandler.promiseCatch('registering slash commands')
    })

    this.application.on('minecraftSelfBroadcast', (): void => {
      timeoutId.refresh()
    })
    this.application.on('instanceAnnouncement', (event): void => {
      if (event.instanceType === InstanceType.Minecraft) {
        timeoutId.refresh()
      }
    })
  }

  private addDefaultCommands(): void {
    const toAdd = [
      AcceptCommand,
      BlacklistCommand,
      DashboardCommand,
      DisconnectCommand,
      ExecuteCommand,
      InviteCommand,
      JoinCommand,
      ListCommand,
      LogCommand,
      RankCommand,
      ReconnectCommand,
      RestartCommand
    ]

    for (const command of toAdd) {
      this.commands.set(command.getCommandBuilder().name, command)
    }
  }

  private async onAutoComplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName)
    if (!command) {
      this.logger.warn(`command ${interaction.commandName} not found for autocomplete interaction.`)
      return
    }

    const identifier = this.clientInstance.profileByUser(
      interaction.user,
      interaction.inCachedGuild() ? interaction.member : undefined
    )
    const user = await this.application.core.initializeDiscordUser(identifier, {
      guild: interaction.guild ?? undefined
    })
    const bridgeId = this.application.bridgeResolver.getBridgeIdForChannel(interaction.channelId)
    const permission = user.permission(bridgeId)
    const focusedOption = interaction.options.getFocused(true)

    if (focusedOption.name === 'instance') {
      const connectedInstances = new Set(getConnectedBridgeMinecraftInstanceNames(this.application, bridgeId))
      const query = focusedOption.value.toLowerCase()
      const response = getBridgeMinecraftInstanceNames(this.application, bridgeId)
        .toSorted((left, right) => {
          const leftConnected = connectedInstances.has(left)
          const rightConnected = connectedInstances.has(right)
          if (leftConnected !== rightConnected) {
            return leftConnected ? -1 : 1
          }

          return left.localeCompare(right)
        })
        .filter((instanceName) => instanceName.toLowerCase().includes(query))
        .slice(0, 25)
        .map((instanceName) => ({ name: instanceName, value: instanceName }))

      await interaction.respond(response)
      return
    }

    if (command.autoComplete) {
      const context: DiscordAutoCompleteContext = {
        application: this.application,
        eventHelper: this.eventHelper,
        logger: this.logger,
        errorHandler: this.errorHandler,
        instanceName: this.clientInstance.instanceName,
        user: user,
        permission: permission,
        interaction: interaction,
        allCommands: [...this.commands.values()],
        bridgeId: bridgeId
      }

      try {
        await command.autoComplete(context)
      } catch (error: unknown) {
        this.logger.error(error)
      }
    }
  }

  /*
   * - allow when channel registered and permitted
   * - allow if channel not registered but command requires admin and user is permitted
   * - disallow if not permitted
   * - disallow if not in proper channel
   */
  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    this.logger.trace(`${interaction.user.tag} executing ${interaction.commandName}`)
    const command = this.commands.get(interaction.commandName)

    try {
      const bridgeId = this.application.bridgeResolver.getBridgeIdForChannel(interaction.channelId)
      const channelType = this.getChannelType(interaction.channelId, bridgeId)
      const identifier = this.clientInstance.profileByUser(
        interaction.user,
        interaction.inCachedGuild() ? interaction.member : undefined
      )
      const user = await this.application.core.initializeDiscordUser(identifier, {
        guild: interaction.guild ?? undefined
      })
      const permission = user.permission(bridgeId)

      if (command == undefined) {
        this.logger.debug(`command but it doesn't exist: ${interaction.commandName}`)

        await interaction.reply({
          content: 'Command is not implemented somehow. Maybe there is new a version?',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      if (permission < (command.permission ?? Permission.Anyone)) {
        this.logger.debug('No permission to execute this command')
        assert.ok(command.permission !== undefined)
        assert.ok(command.permission !== Permission.Anyone)
        await interaction.reply({
          content: translateNoPermission(this.application, command.permission, bridgeId),
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] }
        })
        return
      }

      const scopeCheck = this.checkScope(command.scope ?? CommandScope.Anywhere, channelType)
      if (scopeCheck !== undefined) {
        this.logger.debug(`can't execute in channel ${interaction.channelId}`)
        await interaction.reply({ content: scopeCheck, flags: MessageFlags.Ephemeral })
        return
      }

      const instanceName = interaction.options.getString('instance')
      if (instanceName !== null) {
        const existingInstanceName = this.application
          .getInstancesNames(InstanceType.Minecraft)
          .find((name) => name.toLowerCase() === instanceName.toLowerCase())

        if (existingInstanceName === undefined) {
          this.logger.debug(`instance ${instanceName} does not exist`)
          await interaction.reply({
            content: `The instance \`${escapeMarkdown(instanceName)}\` does not exist!`,
            flags: MessageFlags.Ephemeral
          })
          return
        }

        if (
          bridgeId !== undefined &&
          !this.application.bridgeResolver.shouldProcessEvent(bridgeId, existingInstanceName)
        ) {
          this.logger.debug(`instance ${existingInstanceName} does not belong to bridge ${bridgeId}`)
          await interaction.reply({
            content: `The instance \`${existingInstanceName}\` does not belong to this bridge!`,
            flags: MessageFlags.Ephemeral
          })
          return
        }
      }

      if (
        (command.addMinecraftInstancesToOptions === OptionToAddMinecraftInstances.Required ||
          command.addMinecraftInstancesToOptions === OptionToAddMinecraftInstances.Optional) &&
        this.application.getInstancesNames(InstanceType.Minecraft).length === 0
      ) {
        await interaction.reply({
          embeds: [
            {
              title: `Command ${escapeMarkdown(command.getCommandBuilder().name)}`,
              description:
                `No Minecraft instance exist.\n` +
                'This is a Minecraft command that requires a working Minecraft account connected to the bridge.\n' +
                `Check the tutorial on how to add a Minecraft account before using this command.`,
              color: Color.Info,
              footer: {
                text: DefaultCommandFooter
              }
            }
          ],
          flags: MessageFlags.Ephemeral
        })
        return
      }

      this.logger.trace('execution granted.')

      const commandContext: DiscordCommandContext = {
        application: this.application,
        eventHelper: this.eventHelper,
        logger: this.logger,
        errorHandler: this.errorHandler,
        instanceName: this.clientInstance.instanceName,
        user: user,
        permission: permission,
        interaction: interaction,
        allCommands: [...this.commands.values()],
        bridgeId: bridgeId,

        showPermissionDenied: async (requiredPermission: Exclude<Permission, Permission.Anyone>) => {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
              content: translateNoPermission(this.application, requiredPermission, bridgeId),
              allowedMentions: { parse: [] }
            })
            return
          } else {
            await interaction.reply({
              content: translateNoPermission(this.application, requiredPermission, bridgeId),
              flags: MessageFlags.Ephemeral,
              allowedMentions: { parse: [] }
            })
            return
          }
        }
      }

      await command.handler(commandContext)
      return
    } catch (error) {
      this.logger.error(error)

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: 'There was an error while executing command'
          })
          return
        } else {
          await interaction.reply({
            content: 'There was an error while executing command',
            flags: MessageFlags.Ephemeral
          })
          return
        }
      } catch (replyError) {
        if (replyError instanceof DiscordAPIError && (replyError.code === 10_062 || replyError.code === 10_008)) {
          return
        }
        throw replyError
      }
    }
  }

  private checkScope(scope: CommandScope, channelType: ChannelType | undefined): string | undefined {
    switch (scope) {
      case CommandScope.Chat: {
        if (channelType === ChannelType.Public || channelType === ChannelType.Officer) return undefined
        return 'You can only use commands in public/officer bridge channels!'
      }
      case CommandScope.Privileged: {
        if (channelType === ChannelType.Officer) return undefined
        return 'You can only use commands in officer bridge channels!'
      }
      case CommandScope.Anywhere: {
        return undefined
      }
      default: {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Unknown scope: ${scope}`)
      }
    }
  }

  private async registerDiscordCommand(client: Client<true>): Promise<void> {
    this.logger.trace('Registering commands')

    const token = client.token
    const clientId = client.application.id
    const commandsJson = this.getCommandsJson()

    for (const [, guild] of client.guilds.cache) {
      this.logger.trace(`Informing guild ${guild.id} about commands`)
      const rest = new REST().setToken(token)
      await rest
        .put(Routes.applicationGuildCommands(clientId, guild.id), { body: commandsJson })
        .catch(this.errorHandler.promiseCatch('registering discord commands'))
    }
  }

  private getChannelType(channelId: string, bridgeId?: string): ChannelType | undefined {
    if (bridgeId !== undefined) {
      const type = this.application.bridgeResolver.getChannelTypeForChannel(channelId)
      if (type === 'public') return ChannelType.Public
      if (type === 'officer') return ChannelType.Officer
      return undefined
    }

    const config = this.application.core.discordConfigurations
    if (config.getPublicChannelIds().includes(channelId)) return ChannelType.Public
    if (config.getOfficerChannelIds().includes(channelId)) return ChannelType.Officer
    return undefined
  }

  private getCommandsJson(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    const commandsJson: RESTPostAPIChatInputApplicationCommandsJSONBody[] = []

    /*
    options are added after converting to json.
    This is done to specifically insert the "instance" option directly after the required options
    the official api doesn't support this. So JSON manipulation is used instead.
    This is mainly used for "Required" option.
    Discord will throw an error with "invalid body" otherwise.
     */
    for (const command of this.commands.values()) {
      const commandBuilder = command.getCommandBuilder().toJSON()
      const instanceCommandName = 'instance'
      const instanceCommandDescription = 'Which instance to send this command to'

      const index = commandBuilder.options?.findIndex((option) => option.required) ?? -1

      switch (command.addMinecraftInstancesToOptions) {
        case OptionToAddMinecraftInstances.Required: {
          commandBuilder.options ??= []

          commandBuilder.options.splice(index + 1, 0, {
            type: 3,
            name: instanceCommandName,
            description: instanceCommandDescription,
            autocomplete: true,
            required: true
          })
          break
        }
        case OptionToAddMinecraftInstances.Optional: {
          commandBuilder.options ??= []
          commandBuilder.options.push({
            type: 3,
            name: instanceCommandName,
            description: instanceCommandDescription,
            autocomplete: true
          })
          break
        }
      }

      commandsJson.push(commandBuilder)
    }

    return commandsJson
  }
}
