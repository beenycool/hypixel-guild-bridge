import type { Logger } from 'log4js'
import { SerialExecutor } from '../utility/serial-executor.js'

import type Application from '../application.js'

import type {
  BroadcastEvent,
  ChatEvent,
  CommandEvent,
  CommandFeedbackEvent,
  GuildGeneralEvent,
  GuildPlayerEvent,
  InstanceStatus,
  InstanceType,
  MinecraftReactiveEvent
} from './application-event.js'
import type { Instance } from './instance.js'
import type UnexpectedErrorHandler from './unexpected-error-handler.js'

/**
 * Abstract class with abstract callback functions that must be implemented
 * to integrate bridge to other services. Use this class as a base when connecting two services.
 */
export default abstract class Bridge<K extends Instance<InstanceType>> {
  protected readonly application: Application
  protected readonly clientInstance: K

  protected readonly logger: Logger
  protected readonly errorHandler: UnexpectedErrorHandler
  protected readonly queue: SerialExecutor = new SerialExecutor()
  private readonly cleanups: (() => void)[] = []

  protected constructor(
    application: Application,
    clientInstance: K,
    logger: Logger,
    errorHandler: UnexpectedErrorHandler
  ) {
    this.application = application
    this.clientInstance = clientInstance
    this.logger = logger
    this.errorHandler = errorHandler

    const onCommand = async (event: CommandEvent) => {
      await this.queue
        .run(() => Promise.resolve(this.onCommand(event)))
        .catch(this.errorHandler.promiseCatch('handling command event'))
    }
    this.application.on('command', onCommand)
    this.cleanups.push(() => this.application.off('command', onCommand))

    const onCommandFeedback = async (event: CommandFeedbackEvent) => {
      await this.queue
        .run(() => Promise.resolve(this.onCommandFeedback(event)))
        .catch(this.errorHandler.promiseCatch('handling command feedback'))
    }
    this.application.on('commandFeedback', onCommandFeedback)
    this.cleanups.push(() => this.application.off('commandFeedback', onCommandFeedback))

    const onChat = async (event: ChatEvent) => {
      await this.queue
        .run(() => Promise.resolve(this.onChat(event)))
        .catch(this.errorHandler.promiseCatch('handling chat event'))
    }
    this.application.on('chat', onChat)
    this.cleanups.push(() => this.application.off('chat', onChat))

    const onGuildPlayer = async (event: GuildPlayerEvent) => {
      await this.queue
        .run(() => Promise.resolve(this.onGuildPlayer(event)))
        .catch(this.errorHandler.promiseCatch('handling guildPlayer event'))
    }
    this.application.on('guildPlayer', onGuildPlayer)
    this.cleanups.push(() => this.application.off('guildPlayer', onGuildPlayer))

    const onGuildGeneral = async (event: GuildGeneralEvent) => {
      await this.queue
        .run(() => Promise.resolve(this.onGuildGeneral(event)))
        .catch(this.errorHandler.promiseCatch('handling guildGeneral event'))
    }
    this.application.on('guildGeneral', onGuildGeneral)
    this.cleanups.push(() => this.application.off('guildGeneral', onGuildGeneral))

    const onMinecraftChatEvent = async (event: MinecraftReactiveEvent) => {
      await this.queue
        .run(() => Promise.resolve(this.onMinecraftChatEvent(event)))
        .catch(this.errorHandler.promiseCatch('handling minecraftChat event'))
    }
    this.application.on('minecraftChatEvent', onMinecraftChatEvent)
    this.cleanups.push(() => this.application.off('minecraftChatEvent', onMinecraftChatEvent))

    const onInstanceStatus = async (event: InstanceStatus) => {
      await this.queue
        .run(() => Promise.resolve(this.onInstance(event)))
        .catch(this.errorHandler.promiseCatch('handling instance event'))
    }
    this.application.on('instanceStatus', onInstanceStatus)
    this.cleanups.push(() => this.application.off('instanceStatus', onInstanceStatus))

    const onBroadcast = async (event: BroadcastEvent) => {
      await this.queue
        .run(() => Promise.resolve(this.onBroadcast(event)))
        .catch(this.errorHandler.promiseCatch('handling broadcast event'))
    }
    this.application.on('broadcast', onBroadcast)
    this.cleanups.push(() => this.application.off('broadcast', onBroadcast))
  }

  public dispose(): void {
    for (const cleanup of this.cleanups) {
      cleanup()
    }
    this.cleanups.length = 0
  }

  protected abstract onCommand(event: CommandEvent): void | Promise<void>

  protected abstract onCommandFeedback(event: CommandFeedbackEvent): void | Promise<void>

  protected abstract onChat(event: ChatEvent): void | Promise<void>

  protected abstract onGuildPlayer(event: GuildPlayerEvent): void | Promise<void>

  protected abstract onGuildGeneral(event: GuildGeneralEvent): void | Promise<void>

  protected abstract onMinecraftChatEvent(event: MinecraftReactiveEvent): void | Promise<void>

  protected abstract onInstance(event: InstanceStatus): void | Promise<void>

  protected abstract onBroadcast(event: BroadcastEvent): void | Promise<void>
}
