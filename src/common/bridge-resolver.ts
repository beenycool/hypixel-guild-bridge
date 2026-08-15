import type { BridgeConfig } from '../application-config.js'

import type { DynamicBridgeConfig } from './dynamic-bridge-config.js'

export interface ResolvedBridge {
  id: string
  minecraftInstanceNames: string[]
  publicChannelIds: string[]
  officerChannelIds: string[]
  loggerChannelIds: string[]
  promoteChannelIds: string[]
}

export class BridgeResolver {
  public static readonly DefaultBridgeId = 'default'

  private readonly staticBridges: readonly BridgeConfig[]
  private dynamicConfig: DynamicBridgeConfig | undefined

  private instanceToBridge = new Map<string, string>()
  private publicChannelToBridge = new Map<string, string>()
  private officerChannelToBridge = new Map<string, string>()
  private loggerChannelToBridge = new Map<string, string>()
  private bridgeById = new Map<string, ResolvedBridge>()
  private promoteChannelToBridge = new Map<string, string>()

  constructor(staticBridges: BridgeConfig[] | undefined) {
    this.staticBridges = staticBridges ?? []
    this.rebuildLookupMaps()
  }

  public setDynamicConfig(config: DynamicBridgeConfig): void {
    this.dynamicConfig = config
    this.rebuildLookupMaps()
  }

  public getDynamicConfig(): DynamicBridgeConfig | undefined {
    return this.dynamicConfig
  }

  public rebuildLookupMaps(): void {
    this.instanceToBridge.clear()
    this.publicChannelToBridge.clear()
    this.officerChannelToBridge.clear()
    this.loggerChannelToBridge.clear()
    this.bridgeById.clear()
    this.promoteChannelToBridge.clear()

    for (const bridge of this.staticBridges) {
      for (const instanceName of bridge.minecraftInstanceNames) {
        this.instanceToBridge.set(instanceName.toLowerCase(), bridge.id)
      }
      for (const channelId of bridge.discord.publicChannelIds) {
        this.publicChannelToBridge.set(channelId, bridge.id)
      }
      for (const channelId of bridge.discord.officerChannelIds) {
        this.officerChannelToBridge.set(channelId, bridge.id)
      }
    }

    if (this.dynamicConfig !== undefined) {
      for (const bridgeId of this.dynamicConfig.getAllBridgeIds()) {
        for (const instanceName of this.dynamicConfig.getMinecraftInstances(bridgeId)) {
          this.instanceToBridge.set(instanceName.toLowerCase(), bridgeId)
        }
        for (const channelId of this.dynamicConfig.getPublicChannelIds(bridgeId)) {
          this.publicChannelToBridge.set(channelId, bridgeId)
        }
        for (const channelId of this.dynamicConfig.getOfficerChannelIds(bridgeId)) {
          this.officerChannelToBridge.set(channelId, bridgeId)
        }
        for (const channelId of this.dynamicConfig.getLoggerChannelIds(bridgeId)) {
          this.loggerChannelToBridge.set(channelId, bridgeId)
        }
        for (const channelId of this.dynamicConfig.getPromoteChannelIds(bridgeId)) {
          this.promoteChannelToBridge.set(channelId, bridgeId)
        }
      }
    }

    for (const bridge of this.getAllBridges()) {
      this.bridgeById.set(bridge.id, bridge)
    }
  }

  public isMultiBridgeEnabled(): boolean {
    const hasDynamicBridges = this.dynamicConfig !== undefined && this.dynamicConfig.getAllBridgeIds().length > 0
    return this.staticBridges.length > 0 || hasDynamicBridges
  }

  public getAllBridges(): ResolvedBridge[] {
    const bridgesMap = new Map<string, ResolvedBridge>()

    for (const bridge of this.staticBridges) {
      bridgesMap.set(bridge.id, {
        id: bridge.id,
        minecraftInstanceNames: [...bridge.minecraftInstanceNames],
        publicChannelIds: [...bridge.discord.publicChannelIds],
        officerChannelIds: [...bridge.discord.officerChannelIds],
        loggerChannelIds: [],
        promoteChannelIds: []
      })
    }

    if (this.dynamicConfig !== undefined) {
      for (const bridgeId of this.dynamicConfig.getAllBridgeIds()) {
        bridgesMap.set(bridgeId, {
          id: bridgeId,
          minecraftInstanceNames: this.dynamicConfig.getMinecraftInstances(bridgeId),
          publicChannelIds: this.dynamicConfig.getPublicChannelIds(bridgeId),
          officerChannelIds: this.dynamicConfig.getOfficerChannelIds(bridgeId),
          loggerChannelIds: this.dynamicConfig.getLoggerChannelIds(bridgeId),
          promoteChannelIds: this.dynamicConfig.getPromoteChannelIds(bridgeId)
        })
      }
    }

    return [...bridgesMap.values()]
  }

  public getBridgeIdForInstance(instanceName: string): string | undefined {
    if (!this.isMultiBridgeEnabled()) return undefined
    return this.instanceToBridge.get(instanceName.toLowerCase())
  }

  public getBridgeIdForChannel(channelId: string): string | undefined {
    if (!this.isMultiBridgeEnabled()) return undefined
    return (
      this.publicChannelToBridge.get(channelId) ??
      this.officerChannelToBridge.get(channelId) ??
      this.loggerChannelToBridge.get(channelId) ??
      this.promoteChannelToBridge.get(channelId)
    )
  }

  public getChannelTypeForChannel(channelId: string): 'public' | 'officer' | 'logger' | 'promote' | undefined {
    if (this.publicChannelToBridge.has(channelId)) return 'public'
    if (this.officerChannelToBridge.has(channelId)) return 'officer'
    if (this.loggerChannelToBridge.has(channelId)) return 'logger'
    if (this.promoteChannelToBridge.has(channelId)) return 'promote'
    return undefined
  }

  public getBridgeById(bridgeId: string): ResolvedBridge | undefined {
    return this.bridgeById.get(bridgeId)
  }

  public getPublicChannelIds(bridgeId: string | undefined): string[] {
    if (!this.isMultiBridgeEnabled()) return []
    if (bridgeId === undefined) return []

    const bridge = this.getBridgeById(bridgeId)
    return bridge?.publicChannelIds ?? []
  }

  public getOfficerChannelIds(bridgeId: string | undefined): string[] {
    if (!this.isMultiBridgeEnabled()) return []
    if (bridgeId === undefined) return []

    const bridge = this.getBridgeById(bridgeId)
    return bridge?.officerChannelIds ?? []
  }

  public getLoggerChannelIds(bridgeId: string | undefined): string[] {
    if (!this.isMultiBridgeEnabled()) return []
    if (bridgeId === undefined) return []

    const bridge = this.getBridgeById(bridgeId)
    return bridge?.loggerChannelIds ?? []
  }

  public getPromoteChannelIds(bridgeId: string | undefined): string[] {
    if (!this.isMultiBridgeEnabled()) return []
    if (bridgeId === undefined) return []

    const bridge = this.getBridgeById(bridgeId)
    return bridge?.promoteChannelIds ?? []
  }

  public bridgesMatch(bridgeId1: string | undefined, bridgeId2: string | undefined): boolean {
    if (!this.isMultiBridgeEnabled()) return true

    if (bridgeId1 === undefined && bridgeId2 === undefined) return true

    return bridgeId1 === bridgeId2
  }

  public shouldProcessEvent(eventBridgeId: string | undefined, instanceName: string): boolean {
    if (!this.isMultiBridgeEnabled()) return true

    const instanceBridgeId = this.getBridgeIdForInstance(instanceName)

    if (eventBridgeId === undefined) return true

    if (instanceBridgeId === undefined) return false

    return instanceBridgeId === eventBridgeId
  }
}
