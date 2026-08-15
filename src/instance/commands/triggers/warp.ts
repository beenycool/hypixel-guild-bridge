import type Application from '../../../application.js'
import {
  ChannelType,
  Color,
  InstanceType,
  type MinecraftRawChatEvent,
  MinecraftSendChatPriority
} from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { Status } from '../../../common/connectable-instance.js'
import { sleep } from '../../../utility/shared-utility'
import { Timeout } from '../../../utility/timeout.js'
// eslint-disable-next-line import/no-restricted-paths
import type MinecraftInstance from '../../minecraft/minecraft-instance.js'
// eslint-disable-next-line import/no-restricted-paths
import type { MinecraftManager } from '../../minecraft/minecraft-manager.js'

interface Stopwatch {
  startedAt: number
  stageStartedAt: number
  log: (context: ChatCommandContext, label: string) => void
}

function createStopwatch(): Stopwatch {
  const startedAt = Date.now()
  return {
    startedAt: startedAt,
    stageStartedAt: startedAt,
    log(context: ChatCommandContext, label: string): void {
      const now = Date.now()
      context.logger.info(`[warp] ${label} took ${now - this.stageStartedAt}ms (total ${now - this.startedAt}ms)`)
      this.stageStartedAt = now
    }
  }
}

export default class Warp extends ChatCommandHandler {
  private static readonly CommandCoolDown = 60_000
  private lastCommandExecutionAt = 0

  constructor() {
    super({
      category: 'Guild',
      triggers: ['warp'],
      description: 'Warp a player out of a lobby',
      example: `warp Steve`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if (context.args.length === 0) {
      return this.getExample(context.commandPrefix)
    }

    const currentTime = Date.now()
    if (this.lastCommandExecutionAt + Warp.CommandCoolDown > currentTime) {
      const remainingSeconds = Math.floor((this.lastCommandExecutionAt + Warp.CommandCoolDown - currentTime) / 1000)
      context.logger.info(`[warp] blocked by cooldown, ${remainingSeconds}s remaining`)
      return `Can use command again in ${remainingSeconds} seconds.`
    }

    const username = context.args[0]
    const instance = this.getActiveMinecraftInstanceName(
      context.app.minecraftManager,
      context.message.instanceType === InstanceType.Minecraft ? context.message.instanceName : undefined
    )
    if (instance === undefined) {
      context.logger.info(`[warp] no active connected Minecraft instance to use`)
      return `No active connected Minecraft account exists to use`
    }

    this.lastCommandExecutionAt = currentTime

    context.logger.info(`[warp] started | username=${username} | instance=${instance.instanceName}`)
    const response = await this.warpPlayer(instance, context, username)
    context.logger.info(`[warp] finished | result="${response}"`)

    return response
  }

  private getActiveMinecraftInstanceName(
    minecraftManager: MinecraftManager,
    preferredInstanceName: string | undefined
  ): MinecraftInstance | undefined {
    const availableInstances = minecraftManager
      .getAllInstances()
      .filter((instance) => instance.currentStatus() === Status.Connected)

    let result: MinecraftInstance | undefined
    if (preferredInstanceName !== undefined)
      result = availableInstances.find(
        (instance) => instance.instanceName.toLowerCase() === preferredInstanceName.toLowerCase()
      )
    if (result === undefined && availableInstances.length > 0) result = availableInstances[0]

    return result
  }

  async warpPlayer(instance: MinecraftInstance, context: ChatCommandContext, username: string): Promise<string> {
    const stopwatch = createStopwatch()

    await context.sendFeedback(`Preparing to warp ${username}`)
    const lock = await instance.acquireLimbo()
    stopwatch.log(context, 'acquireLimbo')

    await instance.send('/party leave', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/party leave')

    await instance.send('/lobby', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/lobby')

    await sleep(2000)
    stopwatch.log(context, 'sleep(2000)')

    await instance.send('/skyblock', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/skyblock')

    await sleep(12_000)
    stopwatch.log(context, 'sleep(12000)')

    await instance.send('/hub', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/hub')

    await sleep(2000)
    stopwatch.log(context, 'sleep(2000)')

    const errorMessage = await this.awaitPartyStatus(context.app, instance, context, username)
    stopwatch.log(context, 'awaitPartyStatus (invite wait)')
    if (errorMessage != undefined) {
      context.logger.info(`[warp] invite failed: ${errorMessage}`)

      await instance.send('/party disband', MinecraftSendChatPriority.High, undefined)
      await instance.send('/party leave', MinecraftSendChatPriority.High, undefined)
      stopwatch.log(context, 'cleanup after failed invite')

      lock.resolve()

      return errorMessage
    }

    context.logger.info(`[warp] player joined the party, warping`)
    await instance.send('/party warp', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/party warp')

    await sleep(2000)
    await instance.send('/party disband', MinecraftSendChatPriority.High, undefined)
    await instance.send('/party leave', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, 'cleanup (disband + leave)')

    lock.resolve()

    return 'Player has been warped out!'
  }

  async awaitPartyStatus(
    application: Application,
    instance: MinecraftInstance,
    context: ChatCommandContext,
    username: string
  ): Promise<string | undefined> {
    const inviteSentAt = Date.now()
    const timeout = new Timeout<string | undefined>(30_000, "Player didn't accept the invite.")

    const chatListener = async (event: MinecraftRawChatEvent) => {
      if (event.instanceName !== instance.instanceName) return

      context.logger.info(`[warp] chat during invite wait (${Date.now() - inviteSentAt}ms): "${event.message}"`)

      if (event.message.startsWith("You cannot invite that player since they're not online.")) {
        timeout.resolve('Player not online?')
      } else if (event.message.startsWith("Couldn't find a player with that name")) {
        timeout.resolve("Couldn't find a player with that name!")
      } else if (event.message.startsWith('You cannot invite that player.')) {
        timeout.resolve('Player has party invites disabled.')
      } else if (/^The party invite to (?:\[[+A-Z]{3,10}] )?(\w{3,32}) has expired/.exec(event.message) != undefined) {
        timeout.resolve("Player didn't accept the invite.")
      } else if (/^(?:\[[+A-Z]{3,10}] )?(\w{3,32}) joined the party/.exec(event.message) != undefined) {
        timeout.resolve(undefined)
      }

      const someoneParty = /^You have joined (?:\[[+A-Z]{3,10}] )?(\w{3,32})'s party!/g.exec(event.message)
      if (someoneParty) {
        timeout.resolve(`Accidentally Joined ${someoneParty[1]}'s party!`)

        await application.emit('broadcast', {
          ...context.eventHelper.fillBaseEvent(),

          channels: [ChannelType.Officer],
          color: Color.Bad,

          user: undefined,
          message:
            `Accidentally Joined ${someoneParty[1]}'s party!` +
            ' The offending person might be purposely doing it to abuse the service.'
        })
      }
    }

    await context.sendFeedback(`Sending party invite to warp ${username}`)

    application.on('minecraftChat', chatListener)

    await instance.send(`/party invite ${username} ${username}`, MinecraftSendChatPriority.High, undefined)

    const result = await timeout.wait()
    application.off('minecraftChat', chatListener)

    context.logger.info(
      `[warp] invite wait ended after ${Date.now() - inviteSentAt}ms | timedOut=${timeout.timedOut()} | result=${result ?? 'undefined'}`
    )

    return result
  }
}
