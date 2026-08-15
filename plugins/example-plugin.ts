import type Application from 'src/application'
import type { PluginInfo } from 'src/common/plugin-instance'
import PluginInstance from 'src/common/plugin-instance'
import type { PluginsManager } from 'src/instance/features/plugins-manager'

export default class ExamplePlugin extends PluginInstance {
  constructor(application: Application, pluginsManager: PluginsManager) {
    super(application, pluginsManager, 'example-plugin')
  }

  onReady(): Promise<void> | void {
    this.logger.info('Running on plugin')
  }

  pluginInfo(): PluginInfo {
    return { description: 'This is an example plugin.' }
  }
}
