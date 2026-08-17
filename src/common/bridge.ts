import type { Logger } from 'log4js'

import type Application from '../application.js'
// eslint-disable-next-line import/no-restricted-paths
import { SerialExecutor } from '../utility/serial-executor.js'

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

function createSerializedEventHandler<E>(
  queue: SerialExecutor,
  errorHandler: UnexpectedErrorHandler,
  action: (event: E) => void | Promise<void>,
  context: string
): (event: E) => Promise<void> {
  return async (event) => {
    await queue.run(() => Promise.resolve(action(event))).catch(errorHandler.promiseCatch(context))
  }
}

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

    const onCommand = createSerializedEventHandler(
      this.queue,
      this.errorHandler,
      this.onCommand.bind(this),
      'handling command event'
    )
    this.application.on('command', onCommand)
    this.cleanups.push(() => {
      this.application.off('command', onCommand)
    })

    const onCommandFeedback = createSerializedEventHandler(
      this.queue,
      this.errorHandler,
      this.onCommandFeedback.bind(this),
      'handling command feedback'
    )
    this.application.on('commandFeedback', onCommandFeedback)
    this.cleanups.push(() => {
      this.application.off('commandFeedback', onCommandFeedback)
    })

    const onChat = createSerializedEventHandler(
      this.queue,
      this.errorHandler,
      this.onChat.bind(this),
      'handling chat event'
    )
    this.application.on('chat', onChat)
    this.cleanups.push(() => {
      this.application.off('chat', onChat)
    })

    const onGuildPlayer = createSerializedEventHandler(
      this.queue,
      this.errorHandler,
      this.onGuildPlayer.bind(this),
      'handling guildPlayer event'
    )
    this.application.on('guildPlayer', onGuildPlayer)
    this.cleanups.push(() => {
      this.application.off('guildPlayer', onGuildPlayer)
    })

    const onGuildGeneral = createSerializedEventHandler(
      this.queue,
      this.errorHandler,
      this.onGuildGeneral.bind(this),
      'handling guildGeneral event'
    )
    this.application.on('guildGeneral', onGuildGeneral)
    this.cleanups.push(() => {
      this.application.off('guildGeneral', onGuildGeneral)
    })

    const onMinecraftChatEvent = createSerializedEventHandler(
      this.queue,
      this.errorHandler,
      this.onMinecraftChatEvent.bind(this),
      'handling minecraftChat event'
    )
    this.application.on('minecraftChatEvent', onMinecraftChatEvent)
    this.cleanups.push(() => {
      this.application.off('minecraftChatEvent', onMinecraftChatEvent)
    })

    const onInstanceStatus = createSerializedEventHandler(
      this.queue,
      this.errorHandler,
      this.onInstance.bind(this),
      'handling instance event'
    )
    this.application.on('instanceStatus', onInstanceStatus)
    this.cleanups.push(() => {
      this.application.off('instanceStatus', onInstanceStatus)
    })

    const onBroadcast = createSerializedEventHandler(
      this.queue,
      this.errorHandler,
      this.onBroadcast.bind(this),
      'handling broadcast event'
    )
    this.application.on('broadcast', onBroadcast)
    this.cleanups.push(() => {
      this.application.off('broadcast', onBroadcast)
    })
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
