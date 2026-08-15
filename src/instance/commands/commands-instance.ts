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
import Accessories from './triggers/accessories.js'
import Arcade from './triggers/arcade.js'
import Asian from './triggers/asian.js'
import AuctionHouse from './triggers/auction.js'
import Bedwars from './triggers/bedwars.js'
import Bestiary from './triggers/bestiary'
import Blackjack from './triggers/blackjack.js'
import Blitz from './triggers/blitz.js'
import Boo from './triggers/boo.js'
import Boop from './triggers/boop.js'
import Bow from './triggers/bow.js'
import Buildbattle from './triggers/buildbattle'
import Calculate from './triggers/calculate.js'
import Catacomb from './triggers/catacomb.js'
import Collection from './triggers/collection'
import Cops from './triggers/cops.js'
import Crimson from './triggers/crimson.js'
import DadJoke from './triggers/dadjoke.js'
import Denick from './triggers/denick.js'
import DevelopmentExcuse from './triggers/devexcuse.js'
import Discord from './triggers/discord'
import Dojo from './triggers/dojo.js'
import Droppers from './triggers/droppers.js'
import DuelsBridge from './triggers/duels-bridge.js'
import Duels from './triggers/duels.js'
import Eggs from './triggers/eggs'
import Essence from './triggers/essence.js'
import FairySouls from './triggers/fairysouls.js'
import Fetchur from './triggers/fetchur.js'
import Forge from './triggers/forge.js'
import Garden from './triggers/garden.js'
import Gay from './triggers/gay.js'
import Gtop from './triggers/gtop.js'
import GuildSessions from './triggers/guild-sessions.js'
import Guild from './triggers/guild.js'
import GuildExperience from './triggers/guildexp.js'
import Help from './triggers/help.js'
import HeartOfTheMountain from './triggers/hotm.js'
import Insult from './triggers/insult.js'
import Iq from './triggers/iq.js'
import Kuudra from './triggers/kuudra.js'
import Lesbian from './triggers/lesbian.js'
import Level from './triggers/level.js'
import MagicalPower from './triggers/magicalpower.js'
import Mayor from './triggers/mayor.js'
import Megawalls from './triggers/megawalls.js'
import Murdermystery from './triggers/murdermystery.js'
import Mute from './triggers/mute.js'
import Networth from './triggers/networth.js'
import Paintball from './triggers/paintball.js'
import PartyGames from './triggers/partygames.js'
import Ping from './triggers/ping.js'
import Pit from './triggers/pit.js'
import Player from './triggers/player.js'
import Points30days from './triggers/points-30days'
import PointsAll from './triggers/points-all'
import Praise from './triggers/praise'
import Purse from './triggers/purse.js'
import QCommand from './triggers/q.js'
import Quakecraft from './triggers/quakecraft.js'
import Racism from './triggers/racism.js'
import Rhyme from './triggers/rhyme.js'
import Rng from './triggers/rng.js'
import RockPaperScissors from './triggers/rock-paper-scissors.js'
import Select from './triggers/select'
import SessionCommands from './triggers/sessions.js'
import Skills from './triggers/skills.js'
import Skyblock from './triggers/skyblock.js'
import Skywars from './triggers/skywars'
import Slayer from './triggers/slayer.js'
import SpecialMayors from './triggers/special-mayors'
import Starfall from './triggers/starfall.js'
import StatusCommand from './triggers/status.js'
import Timecharms from './triggers/timecharms.js'
import Tntgames from './triggers/tntgames.js'
import Tnttag from './triggers/tnttag.js'
import Tournament from './triggers/tournament.js'
import Translate from './triggers/translate.js'
import TrophyFish from './triggers/trophyfish.js'
import Unlink from './triggers/unlink.js'
import Unscramble from './triggers/unscramble.js'
import Urchin from './triggers/urchin.js'
import Warp from './triggers/warp.js'
import Weight from './triggers/weight.js'
import Woolwars from './triggers/woolwars.js'

export class CommandsInstance extends ConnectableInstance<InstanceType.Commands> {
  public readonly commands: ChatCommandHandler[]
  private readonly typoSuggestionCooldowns = new Map<string, number>()
  private readonly cooldownCleanupInterval: NodeJS.Timeout
  private readonly commandDeduplicationCache = new Map<string, number>()

  constructor(app: Application) {
    super(app, InternalInstancePrefix + InstanceType.Commands, InstanceType.Commands)

    this.commands = [
      new Arcade(),
      new Asian(),
      new AuctionHouse(),
      new Accessories(),
      new Blitz(),
      new Bedwars(),
      new Bow(),
      new Duels(),
      new DuelsBridge(),
      new Bestiary(),
      new Boo(),
      new Boop(),
      new Buildbattle(),
      new Blackjack(),
      new Calculate(),
      new Catacomb(),
      new Collection(),
      new Cops(),
      new Crimson(),
      new DadJoke(),
      new Denick(),
      new DevelopmentExcuse(),
      new Discord(),
      new Dojo(),
      new Droppers(),
      new Eggs(),
      new EightBallCommand(),
      new Essence(),
      new FairySouls(),
      new Fetchur(),
      new Forge(),
      new Garden(),
      new Gay(),
      new Gtop(),
      new Lesbian(),
      new Guild(),
      new GuildExperience(),
      new GuildSessions(),
      new Help(),
      new HeartOfTheMountain(),
      new Insult(),
      new Iq(),
      new Kuudra(),
      new Level(),
      new MagicalPower(),
      new Mayor(),
      new Megawalls(),
      new Murdermystery(),
      new Mute(),
      new Networth(),
      ...new SessionCommands().resolveCommands(),
      new PartyGames(),
      new Paintball(),
      new Ping(),
      new Pit(),
      new Player(),
      new Points30days(),
      new PointsAll(),
      new Praise(),
      new Purse(),
      new QCommand(),
      new Racism(),
      new Quakecraft(),
      new Rhyme(),
      new Rng(),
      new RockPaperScissors(),
      new Select(),
      new Skills(),
      new Skyblock(),
      new Skywars(),
      new Slayer(),
      new SpecialMayors(),
      new Starfall(),
      new StatusCommand(),
      new Timecharms(),
      new Tntgames(),
      new Tnttag(),
      new TrophyFish(),
      new Tournament(),
      new Unscramble(),
      new Unlink(),
      new Urchin(),
      new Warp(),
      new Weight(),
      new Woolwars(),
      new Translate()
    ]

    this.checkCommandsIntegrity()

    this.application.on('chat', async (event) => {
      await this.handle(event).catch(this.errorHandler.promiseCatch('handling chat event'))
    })

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
  }

  async disconnect(): Promise<void> {
    await this.setAndBroadcastNewStatus(Status.Ended)

    clearInterval(this.cooldownCleanupInterval)

    this.typoSuggestionCooldowns.clear()
  }

  async handle(event: ChatEvent): Promise<void> {
    if (this.currentStatus() !== Status.Connected) return

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

    const bridgeId = event.bridgeId
    const bridgeConfig = this.application.core.bridgeConfigurations
    const globalCommandsConfig = this.application.core.commandsConfigurations

    const commandsEnabled =
      bridgeId === undefined
        ? globalCommandsConfig.getCommandsEnabled()
        : (bridgeConfig.getCommandsEnabled(bridgeId) ?? globalCommandsConfig.getCommandsEnabled())

    if (!commandsEnabled) return

    const chatPrefix =
      bridgeId === undefined
        ? globalCommandsConfig.getChatPrefix()
        : (bridgeConfig.getCommandPrefix(bridgeId) ?? globalCommandsConfig.getChatPrefix())

    if (!event.message.startsWith(chatPrefix)) return

    const messageWithoutPrefix = event.message.slice(chatPrefix.length)
    const helpMatch = /^(\S+)\s+help$/i.exec(messageWithoutPrefix)

    if (helpMatch) {
      const targetCommandName = helpMatch[1].toLowerCase()

      const explainCommandOnHelp =
        bridgeId === undefined
          ? globalCommandsConfig.getExplainCommandOnHelp()
          : (bridgeConfig.getExplainCommandOnHelp(bridgeId) ?? globalCommandsConfig.getExplainCommandOnHelp())

      if (!explainCommandOnHelp) {
        return
      }

      const targetCommand = findCommandByName(this.commands, targetCommandName)

      if (targetCommand) {
        const username = event.user.mojangProfile()?.name ?? event.user.displayName()
        const helpMessage = formatCommandHelp(targetCommand, chatPrefix, username)
        await this.reply(event, 'help', helpMessage)
      } else {
        const suggestions = getCommandSuggestions(this.commands, targetCommandName, 3)
        let response = `Command "${targetCommandName}" does not exist.`

        if (suggestions.length > 0) {
          response += ` Did you mean: ${suggestions.map((s) => s.trigger).join(', ')}?`
        }

        await this.reply(event, 'help', response)
      }

      return
    }

    const commandName = event.message.slice(chatPrefix.length).split(' ')[0].toLowerCase()
    const commandsArguments = event.message.split(' ').slice(1)

    const command = this.commands.find((c) => c.triggers.includes(commandName))
    if (command == undefined) {
      await this.handleUnknownCommand(event, commandName, chatPrefix)
      return
    }

    const disabledCommands =
      bridgeId === undefined
        ? globalCommandsConfig.getDisabledCommands()
        : bridgeConfig.getDisabledCommands(bridgeId).length > 0
          ? bridgeConfig.getDisabledCommands(bridgeId)
          : globalCommandsConfig.getDisabledCommands()

    if (
      disabledCommands.includes(command.triggers[0].toLowerCase()) &&
      (await event.user.permission()) === Permission.Anyone
    ) {
      return
    }

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

      await this.reply(event, command.triggers[0], commandResponse)
    } catch (error) {
      this.logger.error('Error while handling command', error)

      const errorInstance = error instanceof Error ? error : new Error(String(error))
      const errorType = errorInstance.name
      const errorMessage = errorInstance.message
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
              event.bridgeId ?? undefined,
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
    const bridgeId = event.bridgeId
    const bridgeConfig = this.application.core.bridgeConfigurations
    const globalCommandsConfig = this.application.core.commandsConfigurations

    const suggestOnTypo =
      bridgeId === undefined
        ? globalCommandsConfig.getSuggestOnTypo()
        : (bridgeConfig.getSuggestOnTypo(bridgeId) ?? globalCommandsConfig.getSuggestOnTypo())

    if (!suggestOnTypo) return

    const userId = event.user.discordProfile()?.id ?? event.user.mojangProfile()?.id ?? event.user.displayName()
    const now = Date.now()
    const lastSuggestion = this.typoSuggestionCooldowns.get(userId)

    const typoCooldownSeconds =
      bridgeId === undefined
        ? globalCommandsConfig.getTypoCooldownSeconds()
        : (bridgeConfig.getTypoCooldownSeconds(bridgeId) ?? globalCommandsConfig.getTypoCooldownSeconds())

    if (lastSuggestion && now - lastSuggestion < typoCooldownSeconds * 1000) {
      return
    }

    const closestMatch = getClosestCommand(this.commands, commandName)
    if (!closestMatch) return

    const threshold =
      bridgeId === undefined
        ? globalCommandsConfig.getTypoSuggestionThreshold()
        : (bridgeConfig.getTypoSuggestionThreshold(bridgeId) ?? globalCommandsConfig.getTypoSuggestionThreshold())

    const similarityScore = calculateSimilarityScore(commandName, closestMatch.trigger)
    if (similarityScore < threshold) return

    const suggestionMessage = `Did you mean ${chatPrefix}${closestMatch.trigger}?`
    await this.reply(event, 'typo-suggestion', suggestionMessage)

    this.typoSuggestionCooldowns.set(userId, now)
  }

  private cleanupExpiredCooldowns(): void {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000

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
