import type { InstanceStatus, InstanceType } from './application-event.js'
import { InstanceSignalType } from './application-event.js'
import { Instance } from './instance.js'

export abstract class ConnectableInstance<T extends InstanceType> extends Instance<T> {
  private status: Status = Status.Fresh

  public async signal(type: InstanceSignalType): Promise<void> {
    this.logger.log(`instance has received signal type=${type}`)

    if (type === InstanceSignalType.Restart) {
      await this.connect()
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (type === InstanceSignalType.Shutdown) {
      await this.disconnect()
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`unknown instanceSignal type=${type}`)
    }
  }

  public currentStatus(): Status {
    return this.status
  }

  public async setAndBroadcastNewStatus(status: Status): Promise<void> {
    if (this.status === status) return
    const oldStatus = this.status
    this.status = status

    const event = {
      ...this.eventHelper.fillBaseEvent(),

      status: { from: oldStatus, to: status }
    } satisfies InstanceStatus
    await this.broadcastStatusEvent(event)
  }

  private async broadcastStatusEvent(event: InstanceStatus): Promise<void> {
    this.application.core.statusHistory.add(event)

    await this.application.emit('instanceStatus', event)
  }

  public abstract connect(): Promise<void> | void

  public abstract disconnect(): Promise<void> | void
}

export enum Status {
  Fresh = 'fresh',

  Connecting = 'connecting',

  Connected = 'connected',

  Disconnected = 'disconnected',

  Ended = 'ended',

  Failed = 'failed'
}
