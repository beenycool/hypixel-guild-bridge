import type { Logger } from 'log4js'
import Logger4Js from 'log4js'

import type Application from '../application.js'

import { type InstanceIdentifier, InstanceType } from './application-event.js'
import EventHelper from './event-helper.js'
import UnexpectedErrorHandler from './unexpected-error-handler.js'

export abstract class Instance<T extends InstanceType> implements InstanceIdentifier {
  public readonly instanceName: string
  public readonly instanceType: T

  public get bridgeId(): string | undefined {
    if (this.instanceType === InstanceType.Minecraft) {
      return this.application.bridgeResolver.getBridgeIdForInstance(this.instanceName)
    }
    return this.bridgeIdInternal
  }

  private readonly bridgeIdInternal?: string

  readonly application: Application
  readonly logger: Logger
  readonly errorHandler: UnexpectedErrorHandler
  readonly eventHelper: EventHelper<T>

  protected constructor(application: Application, instanceName: string, instanceType: T, bridgeId?: string) {
    this.application = application
    this.instanceName = instanceName
    this.instanceType = instanceType
    this.bridgeIdInternal = bridgeId

    this.logger = Instance.createLogger(instanceName)
    this.errorHandler = new UnexpectedErrorHandler(this.logger)
    this.eventHelper = new EventHelper<T>(this.instanceName, this.instanceType, () => this.bridgeId)
  }

  public static createLogger(name: string): Logger {
    return Logger4Js.getLogger(name)
  }
}

export const InternalInstancePrefix = 'internal/'
