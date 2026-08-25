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
