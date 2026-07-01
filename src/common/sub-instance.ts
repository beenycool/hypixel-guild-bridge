import type { Logger } from 'log4js'

import type Application from '../application.js'

import type { InstanceType } from './application-event.js'
import type { ConnectableInstance } from './connectable-instance.js'
import type EventHelper from './event-helper.js'
import type { Instance } from './instance.js'
import type UnexpectedErrorHandler from './unexpected-error-handler.js'

export default abstract class SubInstance<K extends ConnectableInstance<T> | Instance<T>, T extends InstanceType, O> {
  protected application: Application
  protected clientInstance: K
  protected eventHelper: EventHelper<T>
  protected logger: Logger
  protected errorHandler: UnexpectedErrorHandler

  public constructor(clientInstance: K) {
    this.clientInstance = clientInstance
    this.application = clientInstance.application
    this.eventHelper = clientInstance.eventHelper
    this.logger = clientInstance.logger
    this.errorHandler = clientInstance.errorHandler
  }

  /**
   * Called every time the client reconnects.
   *
   * NOTE: Do not register events that listen on global events.
   * This function will be called multiple times with every reconstruct of the instance.
   * Use constructors functions if you want to register an event once
   * @param option the volatile object that is used to register the event-handler with when the function is called
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public registerEvents(option: O): void {
    // optional to implement
  }

  public dispose(): void {
    // optional override
  }
}
