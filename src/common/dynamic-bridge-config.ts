/**
 * Interface for dynamic bridge configuration sources.
 * Implemented by BridgeConfigurations in core, but defined here
 * so common files can reference it without importing from core.
 */
export interface DynamicBridgeConfig {
  getAllBridgeIds(): string[]
  getMinecraftInstances(bridgeId: string): string[]
  getPublicChannelIds(bridgeId: string): string[]
  getOfficerChannelIds(bridgeId: string): string[]
  getLoggerChannelIds(bridgeId: string): string[]
  getPromoteChannelIds(bridgeId: string): string[]
  getChatSummaryChannelIds(bridgeId: string): string[]
  getChatSummaryEnabled(bridgeId: string): boolean
}
