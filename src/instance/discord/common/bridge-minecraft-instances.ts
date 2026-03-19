import type Application from '../../../application.js'
import { Status } from '../../../common/connectable-instance.js'

function getBridgeMinecraftInstances(application: Application, bridgeId?: string) {
  const instances = application.minecraftManager.getAllInstances()

  if (!application.bridgeResolver.isMultiBridgeEnabled()) {
    return instances
  }

  if (bridgeId === undefined) {
    return []
  }

  return instances.filter((instance) => application.bridgeResolver.shouldProcessEvent(bridgeId, instance.instanceName))
}

export function getBridgeMinecraftInstanceNames(application: Application, bridgeId?: string): string[] {
  return getBridgeMinecraftInstances(application, bridgeId).map((instance) => instance.instanceName)
}

export function getConnectedBridgeMinecraftInstanceNames(application: Application, bridgeId?: string): string[] {
  return getBridgeMinecraftInstances(application, bridgeId)
    .filter((instance) => instance.currentStatus() === Status.Connected)
    .map((instance) => instance.instanceName)
}

export function getFirstConnectedBridgeMinecraftInstanceName(
  application: Application,
  bridgeId?: string
): string | undefined {
  return getConnectedBridgeMinecraftInstanceNames(application, bridgeId)[0]
}

export function getBridgeMinecraftInstanceError(application: Application, bridgeId?: string): string {
  if (application.bridgeResolver.isMultiBridgeEnabled() && bridgeId === undefined) {
    return 'This command must be used in a configured bridge channel.'
  }

  return application.bridgeResolver.isMultiBridgeEnabled()
    ? 'No connected Minecraft instance is available for this bridge.'
    : 'No connected Minecraft instance is available.'
}
