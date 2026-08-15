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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public registerEvents(option: O): void {}

  public dispose(): void {}
}
