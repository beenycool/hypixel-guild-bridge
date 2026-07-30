import type Application from '../../application.js'
import type { ChatEvent, CommandLike } from '../../common/application-event.js'
import { InstanceType, Permission } from '../../common/application-event.js'
import { CommandApiCache } from '../../common/command-api-cache.js'
import type { ChatCommandHandler } from '../../common/commands.js'
import {
  calculateSimilarityScore,
  findCommandByName,
  formatCommandHelp,
  getClosestCommand,
  getCommandSuggestions
} from '../../common/commands.js'
import { ConnectableInstance, Status } from '../../common/connectable-instance.js'
import { InternalInstancePrefix } from '../../common/instance.js'

import EightBallCommand from './triggers/8ball.js'
import Api from './triggers/api.js'
import Arcade from './triggers/arcade.js'
import Asian from './triggers/asian.js'
import AuctionHouse from './triggers/auction.js'
import Bedwars from './triggers/bedwars.js'
import Bestiary from './triggers/bestiary'
import Bits from './triggers/bits.js'
import Boo from './triggers/boo.js'
import Boop from './triggers/boop.js'
import Bow from './triggers/bow.js'
import Buildbattle from './triggers/buildbattle'
import Calculate from './triggers/calculate.js'
import Catacomb from './triggers/catacomb.js'
import Chattermute from './triggers/chattermute.js'
import Chocolate from './triggers/chocolate'
import Collection from './triggers/collection'
import Crimson from './triggers/crimson.js'
import CurrentDungeon from './triggers/current-dungeon.js'
import DadJoke from './triggers/dadjoke.js'
import DarkAuction from './triggers/darkauction.js'
import Denick from './triggers/denick.js'
import DevelopmentExcuse from './triggers/devexcuse.js'
import Discord from './triggers/discord'
import Dojo from './triggers/dojo.js'
import Droppers from './triggers/droppers.js'
import DuelsBridge from './triggers/duels-bridge.js'
import Duels from './triggers/duels.js'
import Eggs from './triggers/eggs'
import Election from './triggers/election.js'
import Execute from './triggers/execute.js'
import Explain from './triggers/explain.js'
import FairySouls from './triggers/fairysouls.js'
import Fetchur from './triggers/fetchur.js'
import Forge from './triggers/forge.js'
import Garden from './triggers/garden.js'
import Gay from './triggers/gay.js'
import Guild from './triggers/guild.js'
import GuildExperience from './triggers/guildexp.js'
import GuildSessions from './triggers/guild-sessions.js'
import Help from './triggers/help.js'
import HeartOfTheMountain from './triggers/hotm.js'
import HypixelLevel from './triggers/hypixel-level'
import Insult from './triggers/insult.js'
import Iq from './triggers/iq.js'
import Kuudra from './triggers/kuudra.js'
import Lesbian from './triggers/lesbian.js'
import Level from './triggers/level.js'
import List from './triggers/list.js'
import MagicalPower from './triggers/magicalpower.js'
import Mayor from './triggers/mayor.js'
import Murdermystery from './triggers/murdermystery.js'
import Mute from './triggers/mute.js'
import Networth from './triggers/networth.js'
import PartyManager from './triggers/party.js'
import PartyGames from './triggers/partygames.js'
import PersonalBest from './triggers/personal-best.js'
import Ping from './triggers/ping.js'
import Player from './triggers/player.js'
import Points30days from './triggers/points-30days'
import PointsAll from './triggers/points-all'
import Praise from './triggers/praise'
import Purse from './triggers/purse.js'
import QCommand from './triggers/q.js'
import QMute from './triggers/qmute.js'
import QMuted from './triggers/qmuted.js'
import Quakecraft from './triggers/quakecraft.js'
import QUnmute from './triggers/qunmute.js'
import Racism from './triggers/racism.js'
import Reputation from './triggers/reputation.js'
import Rhyme from './triggers/rhyme.js'
import Rng from './triggers/rng.js'
import RockPaperScissors from './triggers/rock-paper-scissors.js'
import Roulette from './triggers/roulette.js'
import RunsToClassAverage from './triggers/runs-to-class-average.js'
import Runs from './triggers/runs.js'
import Secrets from './triggers/secrets.js'
import Select from './triggers/select'
import SessionCommands from './triggers/sessions.js'
import Skills from './triggers/skills.js'
import Skyblock from './triggers/skyblock.js'
import Skywars from './triggers/skywars'
import Slayer from './triggers/slayer.js'
import Soopy from './triggers/soopy.js'
import SpecialMayors from './triggers/special-mayors'
import Starfall from './triggers/starfall.js'
import StatusCommand from './triggers/status.js'
import Timecharms from './triggers/timecharms.js'
import Toggle from './triggers/toggle.js'
import Toggled from './triggers/toggled.js'
import Tournament from './triggers/tournament.js'
import Translate from './triggers/translate.js'
import TrophyFish from './triggers/trophyfish.js'
import Unlink from './triggers/unlink.js'
import Unscramble from './triggers/unscramble.js'
import Urchin from './triggers/urchin.js'
import Vengeance from './triggers/vengeance.js'
import Warp from './triggers/warp.js'
import Weight from './triggers/weight.js'
import Winstreak from './triggers/winstreak.js'
import Woolwars from './triggers/woolwars.js'

export class CommandsInstance extends ConnectableInstance<InstanceType.Commands> {
  public readonly commands: ChatCommandHandler[]
  private readonly typoSuggestionCooldowns = new Map<string, number>()
  private readonly cooldownCleanupInterval: NodeJS.Timeout
  private readonly commandDeduplicationCache = new Map<string, number>()

  constructor(app: Application) {
    super(app, InternalInstancePrefix + InstanceType.Commands, InstanceType.Commands)

    this.commands = [
      new Api(),
      new Arcade(),
      new Asian(),
      new AuctionHouse(),
      new Bits(),
      new Bedwars(),
      new Bow(),
      new Duels(),
      new DuelsBridge(),
      new Bestiary(),
      new Boo(),
      new Boop(),
      new Buildbattle(),
      new Calculate(),
      new Catacomb(),
      new Chattermute(),
      new Chocolate(),
      new Collection(),
      new Crimson(),
      new CurrentDungeon(),
      new DadJoke(),
      new Denick(),
      new DarkAuction(),
      new DevelopmentExcuse(),
      new Discord(),
      new Dojo(),
      new Droppers(),
      new Eggs(),
      new Election(),
      new EightBallCommand(),
      new Execute(),
      new Explain(),
      new FairySouls(),
      new Fetchur(),
      new Forge(),
      new Garden(),
      new Gay(),
      new Lesbian(),
      new Guild(),
      new GuildExperience(),
      new GuildSessions(),
      new Help(),
      new HeartOfTheMountain(),
      new HypixelLevel(),
      new Insult(),
      new Iq(),
      new Kuudra(),
      new Level(),
      new List(),
      new MagicalPower(),
      new Mayor(),
      new Murdermystery(),
      new Mute(),
      new Networth(),
      ...new PartyManager().resolveCommands(),
      ...new SessionCommands().resolveCommands(),
      new PartyGames(),
      new PersonalBest(),
      new Ping(),
      new Player(),
      new Points30days(),
      new PointsAll(),
      new Praise(),
      new Purse(),
      new QCommand(),
      new QMute(),
      new QMuted(),
      new QUnmute(),
      new Racism(),
      new Quakecraft(),
      new Reputation(),
      new Rhyme(),
      new Rng(),
      new RockPaperScissors(),
      new Roulette(),
      new Runs(),
      new RunsToClassAverage(),
      new Secrets(),
      new Select(),
      new Skills(),
      new Skyblock(),
      new Skywars(),
      new Slayer(),
      new Soopy(),
      new SpecialMayors(),
      new Starfall(),
      new StatusCommand(),
      new Timecharms(),
      new TrophyFish(),
      new Toggle(),
      new Toggled(),
      new Tournament(),
      new Unscramble(),
      new Unlink(),
      new Urchin(),
      new Vengeance(),
      new Warp(),
      new Weight(),
      new Woolwars(),
      new Winstreak(),
      new Translate()
    ]

    this.checkCommandsIntegrity()

    this.application.on('chat', async (event) => {
      await this.handle(event).catch(this.errorHandler.promiseCatch('handling chat event'))
    })

    // Start cleanup interval for typo suggestion cooldowns (every 5 minutes)
    this.cooldownCleanupInterval = setInterval(
      () => {
        this.cleanupExpiredCooldowns()
      },
      5 * 60 * 1000
    )
  }

  private checkCommandsIntegrity(): void {
    const allTriggers = new Map<string, string>()
    for (const command of this.commands) {
      for (const trigger of command.triggers) {
        if (allTriggers.has(trigger)) {
          const alreadyDefinedCommandName = allTriggers.get(trigger)
          throw new Error(
            `Trigger already defined in ${alreadyDefinedCommandName} when trying to add it to ${command.triggers[0]}`
          )
        } else {
          allTriggers.set(trigger, command.triggers[0])
        }
      }
    }
  }

  async connect(): Promise<void> {
    this.checkCommandsIntegrity()
    await this.setAndBroadcastNewStatus(Status.Connected)
    this.logger.debug('chat commands are ready to serve')
  }

  async disconnect(): Promise<void> {
    await this.setAndBroadcastNewStatus(Status.Ended)
    this.logger.debug('chat commands have been disabled')

    // Clean up cooldown interval
    clearInterval(this.cooldownCleanupInterval)

    // Clear all cooldowns
    this.typoSuggestionCooldowns.clear()
  }

  async handle(event: ChatEvent): Promise<void> {
    if (this.currentStatus() !== Status.Connected) return

    // Deduplicate in-game commands when multiple bots share the same Hypixel guild
    if (event.instanceType === InstanceType.Minecraft) {
      const now = Date.now()
      const dedupKey = `${event.user.displayName()}:${event.message.trim().toLowerCase()}`
      const lastExecuted = this.commandDeduplicationCache.get(dedupKey)

      if (lastExecuted !== undefined && now - lastExecuted < 2000) {
        return
      }
      this.commandDeduplicationCache.set(dedupKey, now)

      if (this.commandDeduplicationCache.size > 100) {
        for (const [key, timestamp] of this.commandDeduplicationCache.entries()) {
          if (now - timestamp > 5000) this.commandDeduplicationCache.delete(key)
        }
      }
    }

    // Resolve bridge-specific settings or fall back to global
    const bridgeId = event.bridgeId
    const bridgeConfig = this.application.core.bridgeConfigurations
    const globalCommandsConfig = this.application.core.commandsConfigurations

    // Check if commands are enabled for this bridge
    const commandsEnabled =
      bridgeId === undefined
        ? globalCommandsConfig.getCommandsEnabled()
        : (bridgeConfig.getCommandsEnabled(bridgeId) ?? globalCommandsConfig.getCommandsEnabled())

    if (!commandsEnabled) return

    // Get the chat prefix for this bridge
    const chatPrefix =
      bridgeId === undefined
        ? globalCommandsConfig.getChatPrefix()
        : (bridgeConfig.getCommandPrefix(bridgeId) ?? globalCommandsConfig.getChatPrefix())

    if (!event.message.startsWith(chatPrefix)) return

    // Check for help pattern: !<command> help
    const messageWithoutPrefix = event.message.slice(chatPrefix.length)
    const helpMatch = /^(\S+)\s+help$/i.exec(messageWithoutPrefix)

    if (helpMatch) {
      const targetCommandName = helpMatch[1].toLowerCase()

      // Check if explainCommandOnHelp is enabled for this bridge
      const explainCommandOnHelp =
        bridgeId === undefined
          ? globalCommandsConfig.getExplainCommandOnHelp()
          : (bridgeConfig.getExplainCommandOnHelp(bridgeId) ?? globalCommandsConfig.getExplainCommandOnHelp())

      if (!explainCommandOnHelp) {
        // Help explanation is disabled, don't respond
        return
      }

      // Look up the target command
      const targetCommand = findCommandByName(this.commands, targetCommandName)

      if (targetCommand) {
        // Command exists, provide help
        const username = event.user.mojangProfile()?.name ?? event.user.displayName()
        const helpMessage = formatCommandHelp(targetCommand, chatPrefix, username)
        await this.reply(event, 'help', helpMessage)
      } else {
        // Command doesn't exist, provide suggestions
        const suggestions = getCommandSuggestions(this.commands, targetCommandName, 3)
        let response = `Command "${targetCommandName}" does not exist.`

        if (suggestions.length > 0) {
          response += ` Did you mean: ${suggestions.map((s) => s.trigger).join(', ')}?`
        }

        await this.reply(event, 'help', response)
      }

      return // Don't process as normal command
    }

    const commandName = event.message.slice(chatPrefix.length).split(' ')[0].toLowerCase()
    const commandsArguments = event.message.split(' ').slice(1)

    const command = this.commands.find((c) => c.triggers.includes(commandName))
    if (command == undefined) {
      // Command not found, check if we should suggest alternatives
      await this.handleUnknownCommand(event, commandName, chatPrefix)
      return
    }

    // Get disabled commands for this bridge (per-bridge replaces global)
    const disabledCommands =
      bridgeId === undefined
        ? globalCommandsConfig.getDisabledCommands()
        : bridgeConfig.getDisabledCommands(bridgeId).length > 0
          ? bridgeConfig.getDisabledCommands(bridgeId)
          : globalCommandsConfig.getDisabledCommands()

    // Disabled commands can only be used by officers and admins, regular users cannot use them
    if (
      disabledCommands.includes(command.triggers[0].toLowerCase()) &&
      (await event.user.permission()) === Permission.Anyone
    ) {
      return
    }

    this.logger.debug(
      `[cmd] ${event.user.displayName()} executing "${event.message}" on bridge="${bridgeId ?? 'none'}"`
    )

    try {
      const commandResponse = await command.handler({
        app: this.application,

        apiCache: new CommandApiCache(),

        eventHelper: this.eventHelper,
        logger: this.logger,
        errorHandler: this.errorHandler,

        allCommands: this.commands,
        commandPrefix: chatPrefix,

        message: event,
        username: event.user.mojangProfile()?.name ?? event.user.displayName(),
        args: commandsArguments,

        sendFeedback: async (feedbackResponse) => {
          await this.feedback(event, command.triggers[0], feedbackResponse)
        }
      })

      this.logger.debug(`[cmd] response for "${command.triggers[0]}": ${commandResponse}`)
      await this.reply(event, command.triggers[0], commandResponse)
    } catch (error) {
      this.logger.error('Error while handling command', error)

      const errorInstance = error instanceof Error ? error : new Error(String(error))
      const errorType = errorInstance.name ?? errorInstance.constructor.name
      const errorMessage = errorInstance.message ?? 'unknown error'
      const errorStack = errorInstance.stack ?? ''

      const randomSuffix = (Math.random() + 1).toString(36).slice(7)

      this.application.core.databaseManager.enqueueWrite(
        `saving command error for ${command.triggers[0]}`,
        async (database) => {
          await database.query(
            `INSERT INTO "commandErrors" ("commandName", "commandMessage", "username", "instanceName", "instanceType", "bridgeId", "errorType", "errorMessage", "errorStack")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              command.triggers[0],
              event.message,
              event.user.displayName(),
              event.instanceName,
              event.instanceType,
              event.bridgeId ?? null,
              errorType,
              errorMessage,
              errorStack
            ]
          )
        }
      )

      const userMessage =
        event.user.displayName() +
        ', an error occurred while trying to execute ' +
        command.triggers[0] +
        '. (' +
        randomSuffix +
        ')'
      await this.reply(event, command.triggers[0], userMessage)
    }
  }

  private async reply(event: ChatEvent, commandName: string, response: string): Promise<void> {
    await this.application.emit('command', this.format(event, commandName, response))
  }

  private async feedback(event: ChatEvent, commandName: string, response: string): Promise<void> {
    await this.application.emit('commandFeedback', this.format(event, commandName, response))
  }

  private async handleUnknownCommand(event: ChatEvent, commandName: string, chatPrefix: string): Promise<void> {
    // Resolve bridge-specific settings or fall back to global
    const bridgeId = event.bridgeId
    const bridgeConfig = this.application.core.bridgeConfigurations
    const globalCommandsConfig = this.application.core.commandsConfigurations

    // Check if typo suggestions are enabled
    const suggestOnTypo =
      bridgeId === undefined
        ? globalCommandsConfig.getSuggestOnTypo()
        : (bridgeConfig.getSuggestOnTypo(bridgeId) ?? globalCommandsConfig.getSuggestOnTypo())

    if (!suggestOnTypo) return

    // Check cooldown for this user
    const userId = event.user.discordProfile()?.id ?? event.user.mojangProfile()?.id ?? event.user.displayName()
    const now = Date.now()
    const lastSuggestion = this.typoSuggestionCooldowns.get(userId)

    const typoCooldownSeconds =
      bridgeId === undefined
        ? globalCommandsConfig.getTypoCooldownSeconds()
        : (bridgeConfig.getTypoCooldownSeconds(bridgeId) ?? globalCommandsConfig.getTypoCooldownSeconds())

    if (lastSuggestion && now - lastSuggestion < typoCooldownSeconds * 1000) {
      return // Still in cooldown
    }

    // Get the best matching command
    const closestMatch = getClosestCommand(this.commands, commandName)
    if (!closestMatch) return

    // Get threshold setting
    const threshold =
      bridgeId === undefined
        ? globalCommandsConfig.getTypoSuggestionThreshold()
        : (bridgeConfig.getTypoSuggestionThreshold(bridgeId) ?? globalCommandsConfig.getTypoSuggestionThreshold())

    // Check if the similarity score is above threshold
    const similarityScore = calculateSimilarityScore(commandName, closestMatch.trigger)
    if (similarityScore < threshold) return

    // Send suggestion message
    const suggestionMessage = `Did you mean ${chatPrefix}${closestMatch.trigger}?`
    await this.reply(event, 'typo-suggestion', suggestionMessage)

    // Update cooldown
    this.typoSuggestionCooldowns.set(userId, now)
  }

  private cleanupExpiredCooldowns(): void {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const [userId, timestamp] of this.typoSuggestionCooldowns.entries()) {
      if (now - timestamp > maxAge) {
        this.typoSuggestionCooldowns.delete(userId)
      }
    }
  }

  private format(event: ChatEvent, commandName: string, response: string): CommandLike {
    switch (event.instanceType) {
      case InstanceType.Discord: {
        return {
          eventId: this.eventHelper.generate(),
          createdAt: Date.now(),

          instanceName: event.instanceName,
          instanceType: event.instanceType,

          channelType: event.channelType,
          originEventId: event.eventId,
          user: event.user,

          bridgeId: event.bridgeId,

          commandName: commandName,
          commandResponse: response
        }
      }

      case InstanceType.Minecraft: {
        return {
          eventId: this.eventHelper.generate(),
          createdAt: Date.now(),

          instanceName: event.instanceName,
          instanceType: event.instanceType,

          channelType: event.channelType,
          originEventId: event.eventId,
          user: event.user,

          bridgeId: event.bridgeId,

          commandName: commandName,
          commandResponse: response
        }
      }

      default: {
        return {
          eventId: this.eventHelper.generate(),
          createdAt: Date.now(),

          instanceName: event.instanceName,
          instanceType: event.instanceType,

          channelType: event.channelType,
          originEventId: event.eventId,
          user: event.user,

          bridgeId: event.bridgeId,

          commandName: commandName,
          commandResponse: response
        }
      }
    }
  }
}
