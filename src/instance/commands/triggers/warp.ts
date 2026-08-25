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
  constructor() {
    super({
      category: 'Guild',
      triggers: ['warp'],
      description: 'Warp players out of a lobby',
      example: `warp Steve Alex`
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    if (context.args.length === 0) {
      return this.getExample(context.commandPrefix)
    }

    const usernames = context.args
    const instance = this.getActiveMinecraftInstanceName(
      context.app.minecraftManager,
      context.message.instanceType === InstanceType.Minecraft ? context.message.instanceName : undefined
    )
    if (instance === undefined) {
      context.logger.info(`[warp] no active connected Minecraft instance to use`)
      return `No active connected Minecraft account exists to use`
    }

    context.logger.info(`[warp] started | usernames=${usernames.join(', ')} | instance=${instance.instanceName}`)
    const response = await this.warpPlayers(instance, context, usernames)
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

  async warpPlayers(instance: MinecraftInstance, context: ChatCommandContext, usernames: string[]): Promise<string> {
    const stopwatch = createStopwatch()

    await context.sendFeedback(`Preparing to warp ${usernames.length} player${usernames.length === 1 ? '' : 's'}`)
    const lock = await instance.acquireLimbo()
    stopwatch.log(context, 'acquireLimbo')

    await instance.send('/party leave', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/party leave')

    await instance.send('/lobby', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/lobby')

    await sleep(3000)
    stopwatch.log(context, 'sleep(3000)')

    await instance.send('/hub', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/hub')

    await sleep(1500)
    stopwatch.log(context, 'sleep(1500)')

    const errorMessage = await this.awaitAllPlayersJoined(context.app, instance, context, usernames)
    stopwatch.log(context, 'awaitAllPlayersJoined (invite wait)')
    if (errorMessage != undefined) {
      context.logger.info(`[warp] invite failed: ${errorMessage}`)

      await instance.send('/party disband', MinecraftSendChatPriority.High, undefined)
      await instance.send('/party leave', MinecraftSendChatPriority.High, undefined)
      stopwatch.log(context, 'cleanup after failed invite')

      lock.resolve()

      return errorMessage
    }

    context.logger.info(`[warp] all players joined the party, warping`)
    await instance.send('/party warp', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, '/party warp')

    await sleep(2000)
    await instance.send('/party disband', MinecraftSendChatPriority.High, undefined)
    await instance.send('/party leave', MinecraftSendChatPriority.High, undefined)
    stopwatch.log(context, 'cleanup (disband + leave)')

    lock.resolve()

    return usernames.length === 1 ? 'Player has been warped out!' : `${usernames.length} players have been warped out!`
  }

  async awaitAllPlayersJoined(
    application: Application,
    instance: MinecraftInstance,
    context: ChatCommandContext,
    usernames: string[]
  ): Promise<string | undefined> {
    const inviteSentAt = Date.now()
    const joinedNames = new Set<string>()
    const total = usernames.length
    const invitedNames = new Set(usernames.map((username) => username.toLowerCase()))

    let resolveResult!: (result: string | undefined) => void
    const resultPromise = new Promise<string | undefined>((resolve) => {
      resolveResult = resolve
    })

    const chatListener = async (event: MinecraftRawChatEvent) => {
      if (event.instanceName !== instance.instanceName) return

      context.logger.info(`[warp] chat during invite wait (${Date.now() - inviteSentAt}ms): "${event.message}"`)

      if (event.message.startsWith("You cannot invite that player since they're not online.")) {
        resolveResult('Player not online?')
      } else if (event.message.startsWith("Couldn't find a player with that name")) {
        resolveResult("Couldn't find a player with that name!")
      } else if (event.message.startsWith('You cannot invite that player.')) {
        resolveResult('Player has party invites disabled.')
      } else {
        const expired = /^The party invite to (?:\[[+A-Z]{3,10}] )?(\w{3,32}) has expired/.exec(event.message)
        if (expired) {
          context.logger.info(`[warp] invite for ${expired[1]} expired, re-inviting`)
          await instance.send(`/party invite ${expired[1]}`, MinecraftSendChatPriority.High, undefined)
        } else {
          const joined = /^(?:\[[+A-Z]{3,10}] )?(\w{3,32}) joined the party/.exec(event.message)
          if (joined && invitedNames.has(joined[1].toLowerCase()) && !joinedNames.has(joined[1])) {
            joinedNames.add(joined[1])
            context.logger.info(`[warp] ${joined[1]} joined the party (${joinedNames.size}/${total})`)
            await context.sendFeedback(`${joinedNames.size}/${total} joined`)
            if (joinedNames.size === total) resolveResult(undefined)
          }
        }
      }

      const someoneParty = /^You have joined (?:\[[+A-Z]{3,10}] )?(\w{3,32})'s party!/g.exec(event.message)
      if (someoneParty) {
        resolveResult(`Accidentally Joined ${someoneParty[1]}'s party!`)

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

    await context.sendFeedback(`Sending party invites to warp ${usernames.join(', ')}`)

    application.on('minecraftChat', chatListener)

    for (const username of usernames) {
      await instance.send(`/party invite ${username}`, MinecraftSendChatPriority.High, undefined)
    }

    const result = await resultPromise
    application.off('minecraftChat', chatListener)

    context.logger.info(
      `[warp] invite wait ended after ${Date.now() - inviteSentAt}ms | result=${result ?? 'undefined'}`
    )

    return result
  }
}
