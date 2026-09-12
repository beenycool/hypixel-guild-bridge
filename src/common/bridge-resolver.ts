import type { DynamicBridgeConfig } from './dynamic-bridge-config.js'

interface ResolvedBridge {
  id: string
  minecraftInstanceNames: string[]
  publicChannelIds: string[]
  officerChannelIds: string[]
  loggerChannelIds: string[]
  promoteChannelIds: string[]
}

export class BridgeResolver {
  private dynamicConfig: DynamicBridgeConfig | undefined

  private instanceToBridge = new Map<string, string>()
  private publicChannelToBridge = new Map<string, string>()
  private officerChannelToBridge = new Map<string, string>()
  private loggerChannelToBridge = new Map<string, string>()
  private bridgeById = new Map<string, ResolvedBridge>()
  private promoteChannelToBridge = new Map<string, string>()
  private conflictedChannels = new Set<string>()
  private conflicts: string[] = []

  constructor() {
    this.rebuildLookupMaps()
  }

  public setDynamicConfig(config: DynamicBridgeConfig): void {
    this.dynamicConfig = config
    this.rebuildLookupMaps()
  }

  public getDynamicConfig(): DynamicBridgeConfig | undefined {
    return this.dynamicConfig
  }

  private assignScoped(
    map: Map<string, string>,
    conflicted: Set<string>,
    key: string,
    bridgeId: string,
    label: string
  ): void {
    if (conflicted.has(key)) return

    const existing = map.get(key)
    if (existing !== undefined && existing !== bridgeId) {
      this.conflicts.push(`${label} is assigned to both bridge "${existing}" and bridge "${bridgeId}"; ignoring it`)
      map.delete(key)
      conflicted.add(key)
      return
    }

    map.set(key, bridgeId)
  }

  public getConflicts(): string[] {
    return [...this.conflicts]
  }

  public rebuildLookupMaps(): void {
    this.instanceToBridge.clear()
    this.publicChannelToBridge.clear()
    this.officerChannelToBridge.clear()
    this.loggerChannelToBridge.clear()
    this.bridgeById.clear()
    this.promoteChannelToBridge.clear()
    this.conflictedChannels.clear()
    this.conflicts = []

    if (this.dynamicConfig !== undefined) {
      const conflictedInstances = new Set<string>()
      for (const bridgeId of this.dynamicConfig.getAllBridgeIds()) {
        for (const instanceName of this.dynamicConfig.getMinecraftInstances(bridgeId)) {
          this.assignScoped(
            this.instanceToBridge,
            conflictedInstances,
            instanceName.toLowerCase(),
            bridgeId,
            `Minecraft instance "${instanceName}"`
          )
        }
      }

      for (const bridgeId of this.dynamicConfig.getAllBridgeIds()) {
        for (const channelId of this.dynamicConfig.getPublicChannelIds(bridgeId)) {
          this.assignScoped(
            this.publicChannelToBridge,
            this.conflictedChannels,
            channelId,
            bridgeId,
            `Discord channel "${channelId}" (public)`
          )
        }
        for (const channelId of this.dynamicConfig.getOfficerChannelIds(bridgeId)) {
          this.assignScoped(
            this.officerChannelToBridge,
            this.conflictedChannels,
            channelId,
            bridgeId,
            `Discord channel "${channelId}" (officer)`
          )
        }
        for (const channelId of this.dynamicConfig.getLoggerChannelIds(bridgeId)) {
          this.assignScoped(
            this.loggerChannelToBridge,
            this.conflictedChannels,
            channelId,
            bridgeId,
            `Discord channel "${channelId}" (logger)`
          )
        }
        for (const channelId of this.dynamicConfig.getPromoteChannelIds(bridgeId)) {
          this.assignScoped(
            this.promoteChannelToBridge,
            this.conflictedChannels,
            channelId,
            bridgeId,
            `Discord channel "${channelId}" (promote)`
          )
        }
      }
    }

    const combinedChannelToBridge = new Map<string, string>()
    const combinedConflicts = new Set<string>()
    for (const [channelId, bridgeId] of this.publicChannelToBridge) {
      this.assignScoped(
        combinedChannelToBridge,
        combinedConflicts,
        channelId,
        bridgeId,
        `Discord channel "${channelId}"`
      )
    }
    for (const [channelId, bridgeId] of this.officerChannelToBridge) {
      this.assignScoped(
        combinedChannelToBridge,
        combinedConflicts,
        channelId,
        bridgeId,
        `Discord channel "${channelId}"`
      )
    }
    for (const [channelId, bridgeId] of this.loggerChannelToBridge) {
      this.assignScoped(
        combinedChannelToBridge,
        combinedConflicts,
        channelId,
        bridgeId,
        `Discord channel "${channelId}"`
      )
    }
    for (const [channelId, bridgeId] of this.promoteChannelToBridge) {
      this.assignScoped(
        combinedChannelToBridge,
        combinedConflicts,
        channelId,
        bridgeId,
        `Discord channel "${channelId}"`
      )
    }
    for (const conflictedChannel of combinedConflicts) {
      this.conflictedChannels.add(conflictedChannel)
    }

    for (const bridge of this.getAllBridges()) {
      this.bridgeById.set(bridge.id, {
        id: bridge.id,
        minecraftInstanceNames: bridge.minecraftInstanceNames.filter(
          (instanceName) => this.instanceToBridge.get(instanceName.toLowerCase()) === bridge.id
        ),
        publicChannelIds: bridge.publicChannelIds.filter(
          (channelId) => this.publicChannelToBridge.get(channelId) === bridge.id
        ),
        officerChannelIds: bridge.officerChannelIds.filter(
          (channelId) => this.officerChannelToBridge.get(channelId) === bridge.id
        ),
        loggerChannelIds: bridge.loggerChannelIds.filter(
          (channelId) => this.loggerChannelToBridge.get(channelId) === bridge.id
        ),
        promoteChannelIds: bridge.promoteChannelIds.filter(
          (channelId) => this.promoteChannelToBridge.get(channelId) === bridge.id
        )
      })
    }
  }

  public getAllBridges(): ResolvedBridge[] {
    const bridgesMap = new Map<string, ResolvedBridge>()

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
    return this.instanceToBridge.get(instanceName.toLowerCase())
  }

  public getBridgeIdForChannel(channelId: string): string | undefined {
    if (this.conflictedChannels.has(channelId)) return undefined

    return (
      this.publicChannelToBridge.get(channelId) ??
      this.officerChannelToBridge.get(channelId) ??
      this.loggerChannelToBridge.get(channelId) ??
      this.promoteChannelToBridge.get(channelId)
    )
  }

  public getChannelTypeForChannel(channelId: string): 'public' | 'officer' | 'logger' | 'promote' | undefined {
    if (this.conflictedChannels.has(channelId)) return undefined

    if (this.publicChannelToBridge.has(channelId)) return 'public'
    if (this.officerChannelToBridge.has(channelId)) return 'officer'
    if (this.loggerChannelToBridge.has(channelId)) return 'logger'
    if (this.promoteChannelToBridge.has(channelId)) return 'promote'
    return undefined
  }

  public getBridgeById(bridgeId: string): ResolvedBridge | undefined {
    return this.bridgeById.get(bridgeId)
  }

  public getPublicChannelIds(bridgeId: string): string[] {
    const bridge = this.getBridgeById(bridgeId)
    return bridge?.publicChannelIds ?? []
  }

  public getOfficerChannelIds(bridgeId: string): string[] {
    const bridge = this.getBridgeById(bridgeId)
    return bridge?.officerChannelIds ?? []
  }

  public getLoggerChannelIds(bridgeId: string): string[] {
    const bridge = this.getBridgeById(bridgeId)
    return bridge?.loggerChannelIds ?? []
  }

  public getPromoteChannelIds(bridgeId: string): string[] {
    const bridge = this.getBridgeById(bridgeId)
    return bridge?.promoteChannelIds ?? []
  }

  public bridgesMatch(bridgeId1: string | undefined, bridgeId2: string | undefined): boolean {
    if (bridgeId1 === undefined || bridgeId2 === undefined) return false

    return bridgeId1 === bridgeId2
  }

  public shouldProcessEvent(eventBridgeId: string | undefined, instanceName: string): boolean {
    if (eventBridgeId === undefined) return false

    const instanceBridgeId = this.getBridgeIdForInstance(instanceName)

    if (instanceBridgeId === undefined) return false

    return instanceBridgeId === eventBridgeId
  }
}
