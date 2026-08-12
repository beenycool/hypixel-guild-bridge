import assert from 'node:assert'

import type Application from '../../application.js'
import { InstanceType, type MinecraftSelfBroadcast } from '../../common/application-event.js'
import { Instance, InternalInstancePrefix } from '../../common/instance.js'
import type { MinecraftInstanceConfig } from '../../core/minecraft/sessions-manager'

import { SentChatMessages } from './common/send-queue.js'
import MinecraftInstance from './minecraft-instance.js'
import { Sanitizer } from './utility/sanitizer.js'

export class MinecraftManager extends Instance<InstanceType.Utility> {
  public sanitizer: Sanitizer

  /**
   * Shared history of chat messages recently sent by any Minecraft instance.
   * Used to recognize the echo of own commands in guild chat.
   */
  public readonly sentChatMessages = new SentChatMessages()

  private readonly instances = new Set<MinecraftInstance>()
  private readonly minecraftBots = new Map<string, MinecraftSelfBroadcast>()
  private readonly botRankCache = new Map<string, string>()
  private readonly botLowerNames = new Set<string>()
  private readonly botLowerUuids = new Set<string>()

  constructor(application: Application) {
    super(application, InternalInstancePrefix + 'MinecraftManager', InstanceType.Utility)
    this.sanitizer = new Sanitizer(application)

    this.application.on('minecraftSelfBroadcast', (event) => {
      this.minecraftBots.set(event.instanceName, event)
      this.botLowerNames.add(event.username.toLowerCase())
      this.botLowerUuids.add(event.uuid.toLowerCase())
    })
  }

  public isMinecraftBot(username: string): boolean {
    const lowered = username.toLowerCase()
    return this.botLowerNames.has(lowered) || this.botLowerUuids.has(lowered)
  }

  public getMinecraftBots(): MinecraftSelfBroadcast[] {
    return Array.from(this.minecraftBots, ([, value]) => value)
  }

  public setBotRank(instanceName: string, rankFormatted: string): void {
    this.botRankCache.set(instanceName.toLowerCase(), rankFormatted)
  }

  public getBotRank(instanceName: string): string | undefined {
    return this.botRankCache.get(instanceName.toLowerCase())
  }

  public loadInstances(): void {
    const instances = this.application.core.minecraftSessions.getAllInstances()
    for (const instanceConfig of instances) {
      const alreadyLoaded = [...this.instances].some(
        (instance) => instance.instanceName.toLowerCase() === instanceConfig.name.toLowerCase()
      )
      if (!alreadyLoaded) {
        this.instances.add(new MinecraftInstance(this.application, instanceConfig.name, instanceConfig))
      }
    }
  }

  public async addAndStart(config: MinecraftInstanceConfig): Promise<void> {
    if (this.getAllInstances().some((instance) => instance.instanceName.toLowerCase() === config.name.toLowerCase())) {
      throw new Error('Minecraft instance name already exists')
    }

    const instance = new MinecraftInstance(this.application, config.name, config)
    this.instances.add(instance)

    try {
      await instance.connect()
    } catch (error: unknown) {
      await instance.disconnect().catch(() => undefined) // it might throw an error if connecting is throwing one already
      this.instances.delete(instance)
      throw error
    }
  }

  public async removeInstance(instanceName: string): Promise<RemoveResultEntry> {
    const result: RemoveResultEntry = {
      name: instanceName,
      instanceRemoved: 0,
      deletedConfig: 0,
      deletedSessionFiles: 0
    }

    const config = this.application.core.minecraftSessions
    result.deletedSessionFiles = config.deleteSession(instanceName)
    result.deletedConfig = config.deleteInstance(instanceName)

    const instances = this.getAllInstances().filter(
      (instance) => instance.instanceName.toLowerCase() === instanceName.toLowerCase()
    )
    for (const instance of instances) {
      await instance.disconnect()
    }

    for (const instance of instances) {
      const broadcast = this.minecraftBots.get(instance.instanceName)
      if (broadcast) {
        this.botLowerNames.delete(broadcast.username.toLowerCase())
        this.botLowerUuids.delete(broadcast.uuid.toLowerCase())
      }
      assert.ok(this.instances.delete(instance))
      this.minecraftBots.delete(instance.instanceName)
      this.botRankCache.delete(instance.instanceName.toLowerCase())
    }
    result.instanceRemoved += instances.length

    return result
  }

  public getAllInstances(): MinecraftInstance[] {
    return [...this.instances.values()]
  }
}

interface RemoveResultEntry {
  instanceRemoved: number
  deletedSessionFiles: number
  deletedConfig: number
  name: string
}
