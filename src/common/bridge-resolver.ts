import type { BridgeConfig } from '../application-config.js'

import type { DynamicBridgeConfig } from './dynamic-bridge-config.js'

/**
 * Represents a resolved bridge with its configuration.
 * Can come from either static config or dynamic database config.
 */
export interface ResolvedBridge {
  id: string
  minecraftInstanceNames: string[]
  publicChannelIds: string[]
  officerChannelIds: string[]
  loggerChannelIds: string[]
}

/**
 * Resolves bridge membership for instances and channels.
 * Supports multi-guild configurations where specific Minecraft instances
 * are linked to specific Discord channels.
 *
 * Configuration sources (in order of priority):
 * 1. Static config from config.yaml (bridges array)
 * 2. Dynamic config from database (via /settings command)
 */
export class BridgeResolver {
  /**
   * Default bridge ID used when no bridges are configured (legacy mode)
   */
  public static readonly DefaultBridgeId = 'default'

  private readonly staticBridges: readonly BridgeConfig[]
  private dynamicConfig: DynamicBridgeConfig | undefined

  // Lookup maps for fast resolution (rebuilt when config changes)
  private instanceToBridge = new Map<string, string>()
  private publicChannelToBridge = new Map<string, string>()
  private officerChannelToBridge = new Map<string, string>()
  private loggerChannelToBridge = new Map<string, string>()

  constructor(staticBridges: BridgeConfig[] | undefined) {
    this.staticBridges = staticBridges ?? []
    this.rebuildLookupMaps()
  }

  /**
   * Set the dynamic configuration source (called after Core is initialized)
   * @param config The dynamic bridge configuration to set
   */
  public setDynamicConfig(config: DynamicBridgeConfig): void {
    this.dynamicConfig = config
    this.rebuildLookupMaps()
  }

  /**
   * Get the dynamic configuration for accessing per-bridge settings
   * @returns The dynamic bridge configuration, or undefined if not set
   */
  public getDynamicConfig(): DynamicBridgeConfig | undefined {
    return this.dynamicConfig
  }

  /**
   * Rebuild lookup maps from both static and dynamic configuration
   */
  public rebuildLookupMaps(): void {
    this.instanceToBridge.clear()
    this.publicChannelToBridge.clear()
    this.officerChannelToBridge.clear()
    this.loggerChannelToBridge.clear()

    // First, add static bridges
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

    // Then, add dynamic bridges (can override static if same ID)
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
      }
    }
  }

  /**
   * Check if multi-bridge mode is enabled (bridges are configured)
   * @returns True if any bridges are configured, false otherwise
   */
  public isMultiBridgeEnabled(): boolean {
    const hasDynamicBridges = this.dynamicConfig !== undefined && this.dynamicConfig.getAllBridgeIds().length > 0
    return this.staticBridges.length > 0 || hasDynamicBridges
  }

  /**
   * Get all configured bridges (merged from static and dynamic)
   * @returns Array of all resolved bridges
   */
  public getAllBridges(): ResolvedBridge[] {
    const bridgesMap = new Map<string, ResolvedBridge>()

    // Add static bridges first
    for (const bridge of this.staticBridges) {
      bridgesMap.set(bridge.id, {
        id: bridge.id,
        minecraftInstanceNames: [...bridge.minecraftInstanceNames],
        publicChannelIds: [...bridge.discord.publicChannelIds],
        officerChannelIds: [...bridge.discord.officerChannelIds],
        loggerChannelIds: []
      })
    }

    // Add/merge dynamic bridges
    if (this.dynamicConfig !== undefined) {
      for (const bridgeId of this.dynamicConfig.getAllBridgeIds()) {
        bridgesMap.set(bridgeId, {
          id: bridgeId,
          minecraftInstanceNames: this.dynamicConfig.getMinecraftInstances(bridgeId),
          publicChannelIds: this.dynamicConfig.getPublicChannelIds(bridgeId),
          officerChannelIds: this.dynamicConfig.getOfficerChannelIds(bridgeId),
          loggerChannelIds: this.dynamicConfig.getLoggerChannelIds(bridgeId)
        })
      }
    }

    return [...bridgesMap.values()]
  }

  /**
   * Resolve the bridge ID for a Minecraft instance name.
   * @param instanceName The Minecraft instance name to look up
   * @returns The bridge ID, or undefined if the instance is not part of any bridge
   */
  public getBridgeIdForInstance(instanceName: string): string | undefined {
    if (!this.isMultiBridgeEnabled()) return undefined
    return this.instanceToBridge.get(instanceName.toLowerCase())
  }

  /**
   * Resolve the bridge ID for a Discord channel.
   * @param channelId The Discord channel ID to look up
   * @returns The bridge ID, or undefined if the channel is not part of any bridge
   */
  public getBridgeIdForChannel(channelId: string): string | undefined {
    if (!this.isMultiBridgeEnabled()) return undefined
    return (
      this.publicChannelToBridge.get(channelId) ??
      this.officerChannelToBridge.get(channelId) ??
      this.loggerChannelToBridge.get(channelId)
    )
  }

  /**
   * Get the channel type (public/officer/logger) for a channel within its bridge.
   * @param channelId The Discord channel ID to look up
   * @returns The channel type, or undefined if the channel is not part of any bridge
   */
  public getChannelTypeForChannel(channelId: string): 'public' | 'officer' | 'logger' | undefined {
    if (this.publicChannelToBridge.has(channelId)) return 'public'
    if (this.officerChannelToBridge.has(channelId)) return 'officer'
    if (this.loggerChannelToBridge.has(channelId)) return 'logger'
    return undefined
  }

  /**
   * Get a bridge configuration by its ID.
   * @param bridgeId - The bridge ID to look up
   * @returns The resolved bridge, or undefined if not found
   */
  public getBridgeById(bridgeId: string): ResolvedBridge | undefined {
    return this.getAllBridges().find((b) => b.id === bridgeId)
  }

  /**
   * Get all public channel IDs for a specific bridge.
   * If bridgeId is undefined and multi-bridge is disabled, returns empty array
   * (caller should use legacy configuration).
   * @param bridgeId - The bridge ID to get channels for
   * @returns Array of public channel IDs
   */
  public getPublicChannelIds(bridgeId: string | undefined): string[] {
    if (!this.isMultiBridgeEnabled()) return []
    if (bridgeId === undefined) return []

    const bridge = this.getBridgeById(bridgeId)
    return bridge?.publicChannelIds ?? []
  }

  /**
   * Get all officer channel IDs for a specific bridge.
   * If bridgeId is undefined and multi-bridge is disabled, returns empty array
   * (caller should use legacy configuration).
   * @param bridgeId - The bridge ID to get channels for
   * @returns Array of officer channel IDs
   */
  public getOfficerChannelIds(bridgeId: string | undefined): string[] {
    if (!this.isMultiBridgeEnabled()) return []
    if (bridgeId === undefined) return []

    const bridge = this.getBridgeById(bridgeId)
    return bridge?.officerChannelIds ?? []
  }

  /**
   * Get all logger channel IDs for a specific bridge.
   * If bridgeId is undefined and multi-bridge is disabled, returns empty array
   * (caller should use legacy configuration).
   * @param bridgeId - The bridge ID to get channels for
   * @returns Array of logger channel IDs
   */
  public getLoggerChannelIds(bridgeId: string | undefined): string[] {
    if (!this.isMultiBridgeEnabled()) return []
    if (bridgeId === undefined) return []

    const bridge = this.getBridgeById(bridgeId)
    return bridge?.loggerChannelIds ?? []
  }

  /**
   * Check if two bridge IDs match (both undefined counts as a match for legacy mode).
   * @param bridgeId1 - The first bridge ID to compare
   * @param bridgeId2 - The second bridge ID to compare
   * @returns True if the bridge IDs match
   */
  public bridgesMatch(bridgeId1: string | undefined, bridgeId2: string | undefined): boolean {
    // If multi-bridge is not enabled, everything matches
    if (!this.isMultiBridgeEnabled()) return true

    // If both are undefined, they match (legacy mode)
    if (bridgeId1 === undefined && bridgeId2 === undefined) return true

    // Otherwise, they must be equal
    return bridgeId1 === bridgeId2
  }

  /**
   * Check if an event with the given bridgeId should be processed by an instance with the given instanceName.
   * @param eventBridgeId The bridge ID from the event to check.
   * @param instanceName The name of the instance to check against.
   * @returns True if the event should be processed by the instance, false otherwise.
   */
  public shouldProcessEvent(eventBridgeId: string | undefined, instanceName: string): boolean {
    if (!this.isMultiBridgeEnabled()) return true

    const instanceBridgeId = this.getBridgeIdForInstance(instanceName)

    // If the event has no bridge ID, it's a global event - process it
    if (eventBridgeId === undefined) return true

    // If the instance is not part of any bridge in multi-bridge mode, it shouldn't process bridge-specific events
    if (instanceBridgeId === undefined) return false

    // Otherwise, only process if bridges match
    return instanceBridgeId === eventBridgeId
  }
}
