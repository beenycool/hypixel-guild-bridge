import type { BaseEvent, InstanceType } from './application-event.js'

export default class EventHelper<K extends InstanceType> {
  private readonly bridgeIdProvider: () => string | undefined

  constructor(
    private readonly instanceName: string,
    private readonly instanceType: K,
    bridgeId?: string | (() => string | undefined)
  ) {
    this.bridgeIdProvider = typeof bridgeId === 'function' ? bridgeId : () => bridgeId
  }
  private lastId = 0

  public generate(): string {
    return `${this.instanceType}:${this.instanceName}:${this.lastId++}`
  }

  public fillBaseEvent(): BaseEvent & { instanceType: K; bridgeId?: string } {
    const event: BaseEvent & { instanceType: K; bridgeId?: string } = {
      eventId: this.generate(),
      createdAt: Date.now(),

      instanceType: this.instanceType,
      instanceName: this.instanceName
    }

    const bridgeId = this.bridgeIdProvider()
    if (bridgeId !== undefined) {
      event.bridgeId = bridgeId
    }

    return event
  }
}
