import type { InstanceType } from '../../../common/application-event.js'
import { MinecraftSendChatPriority } from '../../../common/application-event.js'
import SubInstance from '../../../common/sub-instance'
import { SerialExecutor } from '../../../utility/serial-executor.js'
import { Timeout } from '../../../utility/timeout.js'
import type ClientSession from '../client-session.js'
import { updatePartyState } from '../common/party-state.js'
import type MinecraftInstance from '../minecraft-instance.js'

export default class LimboHandler extends SubInstance<MinecraftInstance, InstanceType.Minecraft, ClientSession> {
  private static readonly DefaultTimeout = 5 * 60 * 1000
  private static readonly DefaultAcquire = 10 * 60 * 1000

  private queue = new SerialExecutor()
  private pendingCount = 0

  private inParty = false
  private readonly minecraftChatListener: (event: { instanceName: string; message: string }) => void

  constructor(clientInstance: MinecraftInstance) {
    super(clientInstance)

    this.minecraftChatListener = (event) => {
      if (event.instanceName !== this.clientInstance.instanceName) return
      const previous = this.inParty
      this.inParty = updatePartyState(event.message, this.inParty)
      if (this.inParty !== previous) {
        this.logger.info(`[limbo] party state ${previous} -> ${this.inParty} | message: "${event.message}"`)
      }
    }
    this.application.on('minecraftChat', this.minecraftChatListener)
  }

  override dispose(): void {
    this.application.off('minecraftChat', this.minecraftChatListener)
  }

  public async acquire(
    timeout: number = LimboHandler.DefaultTimeout,
    maxAcquire: number = LimboHandler.DefaultAcquire
  ): Promise<Timeout<void>> {
    const queueHandler = new Timeout<Timeout<void>>(timeout)

    this.pendingCount++
    void this.queue
      .run(() => {
        if (queueHandler.finished()) return Promise.resolve()

        const acquireHandler = new Timeout<void>(maxAcquire)
        queueHandler.resolve(acquireHandler)

        return acquireHandler.wait()
      })
      .finally(() => {
        this.pendingCount--
        this.logger.info(
          `[limbo] acquire released | empty=${this.empty()}, inParty=${this.inParty}, pendingCount=${this.pendingCount}`
        )
        if (this.empty() && !this.inParty) {
          void this.limbo().catch(this.errorHandler.promiseCatch('handling /limbo command'))
        }
      })
      .catch(this.errorHandler.promiseCatch('queued acquire() LimboHandler'))

    const result = await queueHandler.wait()
    if (result === undefined) throw new Error('Timed out before acquiring the LimboHandler')
    return result
  }

  override registerEvents(clientSession: ClientSession): void {
    clientSession.client.on('login', () => {
      this.logger.info(
        `[limbo] login event | empty=${this.empty()}, inParty=${this.inParty}, pendingCount=${this.pendingCount}`
      )
      if (this.empty() && !this.inParty) {
        this.triggerLimbo().catch(this.errorHandler.promiseCatch('handling /limbo command'))
      }
    })

    clientSession.client.on('respawn', () => {
      this.logger.info(
        `[limbo] respawn event | empty=${this.empty()}, inParty=${this.inParty}, pendingCount=${this.pendingCount}`
      )
      if (this.empty() && !this.inParty) {
        this.triggerLimbo().catch(this.errorHandler.promiseCatch('handling /limbo command'))
      }
    })
  }

  private empty(): boolean {
    return this.pendingCount === 0
  }

  private async triggerLimbo(): Promise<void> {
    await this.limbo()
  }

  private async limbo(): Promise<void> {
    this.logger.info(`[limbo] sending /limbo (inParty=${this.inParty})`)
    await this.clientInstance.send('/limbo', MinecraftSendChatPriority.Default, undefined)
  }
}
