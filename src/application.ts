/* eslint @typescript-eslint/explicit-member-accessibility: "error" */
// @typescript-eslint/explicit-member-accessibility needed since this is part of the public api

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'

import Emittery from 'emittery'
import { Client as HypixelClient } from 'hypixel-api-reborn'
import type { i18n } from 'i18next'
import type { Logger } from 'log4js'
import Logger4js from 'log4js'

export type TranslatorFunction = (
  keyOrSelector: string | ((t: (key: string) => string) => string),
  options?: Record<string, unknown>
) => string

import type { ApplicationConfig, DatabaseConfig } from './application-config.js'
import type { ApplicationEvents, InstanceIdentifier, MinecraftSendChatPriority } from './common/application-event.js'
import { InstanceSignalType, InstanceType } from './common/application-event.js'
import { BridgeResolver } from './common/bridge-resolver.js'
import { ConnectableInstance, Status } from './common/connectable-instance.js'
import PluginInstance from './common/plugin-instance.js'
import UnexpectedErrorHandler from './common/unexpected-error-handler.js'
import { Core } from './core/core'
import { ApplicationLanguages, LanguageConfigurations } from './core/language-configurations'
import type { MojangApi } from './core/users/mojang'
import ApplicationIntegrity from './instance/application-integrity.js'
import AutoRestart from './instance/auto-restart'
import { CommandsInstance } from './instance/commands/commands-instance.js'
import DiscordInstance from './instance/discord/discord-instance.js'
import { PluginsManager } from './instance/features/plugins-manager.js'
import HypixelUpdates from './instance/hypixel-updates'
import MinecraftInstance from './instance/minecraft/minecraft-instance.js'
import { MinecraftManager } from './instance/minecraft/minecraft-manager.js'
import PrometheusInstance from './instance/prometheus/prometheus-instance.js'
import { RandomChatter } from './instance/random-chatter'
import { SkyblockReminders } from './instance/skyblock-reminders'
import { SpontaneousEvents } from './instance/spontaneous-events'
import StatMonitor from './instance/stat-monitor'
import WebServer from './instance/web-server'
import { gracefullyExitProcess, sleep } from './utility/shared-utility'

export type AllInstances =
  | CommandsInstance
  | DiscordInstance
  | PrometheusInstance
  | WebServer
  | Core
  | MinecraftInstance
  | PluginInstance
  | ApplicationIntegrity
  | HypixelUpdates
  | SkyblockReminders
  | SpontaneousEvents
  | StatMonitor
  | AutoRestart
  | MinecraftManager
  | PluginsManager
  | RandomChatter

export default class Application extends Emittery<ApplicationEvents> implements InstanceIdentifier {
  public readonly instanceName: string = InstanceType.Main
  public readonly instanceType: InstanceType = InstanceType.Main

  public readonly applicationIntegrity: ApplicationIntegrity

  public readonly hypixelApi: HypixelClient
  public readonly mojangApi: MojangApi

  public get hypixelApiKey(): string {
    return this.config.general.hypixelApiKey
  }

  public get urchinApiKey(): string | undefined {
    return this.config.general.urchinApiKey
  }

  public getStatsChannelsConfig(): ApplicationConfig['statsChannels'] {
    return this.config.statsChannels
  }

  public getVerificationConfig(): ApplicationConfig['verification'] {
    return this.config.verification
  }

  public getGuildRequirementsConfig(): ApplicationConfig['guildRequirements'] {
    return this.config.guildRequirements
  }

  public getInactivityConfig(): ApplicationConfig['inactivity'] {
    return this.config.inactivity
  }

  public getSkyblockEventsConfig(bridgeId?: string): ApplicationConfig['skyblockEvents'] {
    const staticConfig = this.config.skyblockEvents

    // If multi-bridge is not enabled or no bridgeId provided, return static config as-is
    if (bridgeId === undefined || !this.bridgeResolver.isMultiBridgeEnabled()) return staticConfig

    // Merge static config with bridge-specific overrides (bridge overrides take precedence)
    const merged: ApplicationConfig['skyblockEvents'] = staticConfig ? { ...staticConfig } : { enabled: true }

    // Bridge-specific enabled flag
    const enabled = this.core.bridgeConfigurations.getSkyblockEventsEnabled(bridgeId)
    merged.enabled = enabled

    // Merge notifiers (bridge overrides take precedence)
    const bridgeNotifiers = this.core.bridgeConfigurations.getSkyblockEventNotifiers(bridgeId)
    if (bridgeNotifiers !== undefined) {
      merged.notifiers = { ...merged.notifiers, ...bridgeNotifiers }
    }

    return merged
  }

  public getHypixelUpdatesConfig(): ApplicationConfig['hypixelUpdates'] {
    return this.config.hypixelUpdates
  }

  public getWebConfig(): ApplicationConfig['web'] {
    return this.config.web
  }

  public getDatabaseConfig(): DatabaseConfig | undefined {
    return this.config.database
  }

  public getRootDirectory(): string {
    return this.rootDirectory
  }

  public readonly logger: Logger
  private readonly errorHandler: UnexpectedErrorHandler
  private readonly shutdownListeners: (() => void | Promise<void>)[] = []

  private readonly rootDirectory
  private readonly configsDirectory
  private readonly backupDirectory
  private readonly config: Readonly<ApplicationConfig>

  public readonly discordInstance: DiscordInstance
  public readonly minecraftManager: MinecraftManager
  public readonly pluginsManager: PluginsManager
  public readonly commandsInstance: CommandsInstance
  public core: Core
  public readonly bridgeResolver: BridgeResolver
  private readonly prometheusInstance: PrometheusInstance | undefined
  private readonly webServer: WebServer | undefined

  private readonly skyblockReminders: SkyblockReminders
  private readonly hypixelUpdates: HypixelUpdates
  private readonly spontaneousEvents: SpontaneousEvents
  public readonly randomChatter: RandomChatter
  public readonly statMonitor: StatMonitor
  private readonly autoRestart: AutoRestart

  public constructor(
    config: ApplicationConfig,
    rootDirectory: string,
    configsDirectory: string,
    public i18n: i18n
  ) {
    super()

    this.logger = Logger4js.getLogger('Application')
    this.errorHandler = new UnexpectedErrorHandler(this.logger)
    this.logger.trace('Application initiating')

    this.applicationIntegrity = new ApplicationIntegrity(this)

    this.config = config
    this.configsDirectory = configsDirectory
    this.rootDirectory = rootDirectory

    this.backupDirectory = path.join(configsDirectory, 'backup')
    this.applicationIntegrity.addConfigPath(this.backupDirectory)
    fs.mkdirSync(this.backupDirectory, { recursive: true })

    this.hypixelApi = new HypixelClient(this.config.general.hypixelApiKey, {
      cache: true,
      mojangCacheTime: 300,
      hypixelCacheTime: 300
    })

    this.core = new Core(this)
    this.mojangApi = this.core.mojangApi
    this.bridgeResolver = new BridgeResolver(this.config.bridges)
    // Connect bridge resolver to dynamic config from database
    this.bridgeResolver.setDynamicConfig(this.core.bridgeConfigurations)

    this.discordInstance = new DiscordInstance(this, this.config.discord)

    this.minecraftManager = new MinecraftManager(this)

    this.pluginsManager = new PluginsManager(this)

    this.prometheusInstance = this.config.prometheus.enabled
      ? new PrometheusInstance(this, this.config.prometheus)
      : undefined
    this.webServer = this.config.web?.enabled ? new WebServer(this, this.config.web) : undefined
    this.commandsInstance = new CommandsInstance(this)

    this.skyblockReminders = new SkyblockReminders(this)
    this.hypixelUpdates = new HypixelUpdates(this)
    this.spontaneousEvents = new SpontaneousEvents(this)
    this.randomChatter = new RandomChatter(this)
    this.statMonitor = new StatMonitor(this)
    this.autoRestart = new AutoRestart(this)
  }

  /** Optional Aurora API key used by some plugins */
  public get auroraApiKey(): string | undefined {
    // Prefer environment variable; fallback to undefined (not all configs include this key)
    return process.env.AURORA_API_KEY
  }

  public getConfigFilePath(filename: string): string {
    return path.resolve(this.configsDirectory, path.basename(filename))
  }

  public getBackupPath(name: string): string {
    assert.ok(name.length > 0, "'name' must not be empty")

    const MaxTries = 3
    for (let tryCount = 0; tryCount < MaxTries; tryCount++) {
      const currentTime = Date.now()

      const basename = path.basename(name)
      const extension = path.extname(basename)
      const fileName = basename.slice(0, basename.length - extension.length)
      const fullName = `${fileName}-${currentTime}${extension}`

      const fullPath = path.join(this.backupDirectory, fullName)
      if (fs.existsSync(fullPath)) continue
      return fullPath
    }

    throw new Error(`could not find viable backup path for '${name}'.`)
  }

  public addShutdownListener(listener: () => void | Promise<void>): void {
    this.shutdownListeners.push(listener)
  }

  public changeLanguage(language: ApplicationLanguages): void {
    assert.ok(language)
    assert.ok(Object.values(ApplicationLanguages).includes(language), `Language not supported: ${language}`)
    const languageName = Object.entries(ApplicationLanguages).find(([, value]) => value === language)?.[0]
    assert.ok(languageName !== undefined, `Language ${languageName} is somehow not defined??`)

    this.core.languageConfigurations.setLanguage(language)
    void this.i18n
      .changeLanguage(language)
      .then(() => {
        this.logger.info(`Language changed successfully to ${languageName}.`)
      })
      .catch(this.errorHandler.promiseCatch(`changing language to ${languageName}`))
  }

  /**
   * Get a translator function that respects per-bridge language settings.
   * Resolution precedence: dynamic DB > static bridge config > global application language.
   * Returns a function compatible with `i18n.t` that will call `this.i18n.t` with the resolved `lng` option.
   */
  public getTranslatorForBridge(bridgeId?: string): TranslatorFunction {
    let dynamicLang: string | undefined
    if (bridgeId !== undefined) {
      dynamicLang = this.core.bridgeConfigurations.getLanguage(bridgeId)
    }

    let staticLang: string | undefined
    if (bridgeId !== undefined && this.config.bridges !== undefined) {
      const bridgeCfg = this.config.bridges.find((b) => b.id === bridgeId)
      staticLang = bridgeCfg?.language
    }

    const chosenLang = dynamicLang ?? staticLang

    const translate = (
      keyOrSelector: string | ((t: (key: string) => string) => string),
      options?: Record<string, unknown>
    ) =>
      (this.i18n.t as unknown as TranslatorFunction)(keyOrSelector, {
        ...options,
        ...(chosenLang ? { lng: chosenLang } : {})
      })
    return translate as TranslatorFunction
  }

  public async start(): Promise<void> {
    await this.core.awaitReady()
    this.bridgeResolver.rebuildLookupMaps()
    this.applyStoredLanguage()
    this.minecraftManager.loadInstances()
    await this.pluginsManager.loadPlugins(this.rootDirectory)

    for (const instance of this.getAllInstances()) {
      // must cast first before using due to typescript limitation
      // https://github.com/microsoft/TypeScript/issues/30650#issuecomment-486680485
      const checkedInstance = instance

      if (checkedInstance instanceof ConnectableInstance) {
        this.logger.debug(`Connecting instance type=${instance.instanceType},name=${instance.instanceName}`)
        await checkedInstance.connect()
      } else if (instance instanceof PluginInstance) {
        this.logger.debug(`Signaling plugin instance type=${instance.instanceType},name=${instance.instanceName}`)
        await instance.onReady()
      }
    }

    // Start background utilities that require instances/core to be ready
    try {
      this.randomChatter.start()
    } catch (error: unknown) {
      this.errorHandler.promiseCatch('starting random chatter')(error)
    }
  }

  public async shutdown(): Promise<void> {
    for (const instance of this.getAllInstances().toReversed()) {
      // reversed to go backward of `start()`
      if (instance instanceof ConnectableInstance && instance.currentStatus() !== Status.Fresh) {
        this.logger.debug(`Disconnecting instance type=${instance.instanceType},name=${instance.instanceName}`)
        await instance.disconnect()
      }
    }

    // wait till next cycle to let all events flush out
    // This might not be needed if events can be sent with async/await
    await setImmediate()

    for (const shutdownListener of this.shutdownListeners.toReversed()) {
      await shutdownListener()
    }
  }

  /**
   * Send chat/command via Minecraft instance
   *
   * @param instanceNames The instance names to send the command through.
   * @param priority See {@link MinecraftSendChatPriority}
   * @param eventId
   * @param command The command to send
   */
  public async sendMinecraft(
    instanceNames: string[],
    priority: MinecraftSendChatPriority,
    eventId: string | undefined,
    command: string
  ): Promise<void> {
    const instances = []

    for (const instanceName of instanceNames) {
      const instance = this.instanceByName(instanceName)

      if (instance === undefined) {
        throw new Error(`no instance found with the name "${instanceName}"`)
      } else if (instance instanceof MinecraftInstance) {
        instances.push(instance)
      } else {
        throw new TypeError(`instance is not type MinecraftInstance. Actual=${instance.instanceType}`)
      }
    }

    const tasks = []
    for (const instance of instances) {
      tasks.push(instance.send(command, priority, eventId))
    }
    await Promise.all(tasks)
  }

  /**
   * Signal to shut down/restart an instance.
   *
   * Signaling to shut down the application is possible.
   * It will take some time for the application to shut down.
   * Application will auto restart if a process monitor is used.
   *
   * @param instanceNames The instance names to send the command through.
   * @param type A flag indicating the signal
   */
  public async sendSignal(instanceNames: string[], type: InstanceSignalType): Promise<void> {
    const instances = []

    for (const instanceName of instanceNames) {
      if (instanceName.toLowerCase() === this.instanceName.toLowerCase()) continue
      const instance = this.instanceByName(instanceName)

      if (instance === undefined) {
        throw new Error(`no instance found with the name "${instanceName}"`)
      } else if (instance instanceof ConnectableInstance) {
        instances.push(instance)
      } else {
        throw new TypeError(`instance is not type ConnectableInstance.`)
      }
    }

    const tasks = []
    for (const instance of instances) {
      tasks.push(instance.signal(type))
    }
    await Promise.all(tasks)

    const signalMain = instanceNames.some(
      (instanceName) => instanceName.toLowerCase() === this.instanceName.toLowerCase()
    )
    if (signalMain) {
      await this.receivedSignal(type)
    }
  }

  private async receivedSignal(type: InstanceSignalType): Promise<void> {
    this.logger.info('Shutdown signal has been received. Shutting down this node.')

    if (type === InstanceSignalType.Restart) {
      this.logger.info('Node should auto restart if a process monitor service is used.')
    }

    this.logger.info('Waiting 5 seconds for other nodes to receive the signal before shutting down.')
    await sleep(5000)
      .then(() => {
        this.logger.debug('shutting down application')
        return this.shutdown()
      })
      .then(() => gracefullyExitProcess(2))
      .catch(this.errorHandler.promiseCatch('shutting down application with instanceSignal'))
  }

  public getInstancesNames(instanceType: InstanceType): string[] {
    return this.getAllInstancesIdentifiers()
      .filter((instance) => instance.instanceType === instanceType)
      .map((instance) => instance.instanceName)
  }

  /**
   * Minecraft bot used for Discord `/ping` tab latency: prefer instances for `bridgeId`, otherwise first connected bot.
   */
  public resolveMinecraftInstanceForDiscordPing(bridgeId?: string): MinecraftInstance | undefined {
    const all = this.minecraftManager.getAllInstances()
    if (all.length === 0) return undefined

    let pool: MinecraftInstance[]
    if (bridgeId === undefined) {
      pool = all
    } else {
      const bridged = all.filter((instance) => instance.bridgeId === bridgeId)
      pool = bridged.length > 0 ? bridged : all
    }

    return pool.find((instance) => instance.currentStatus() === Status.Connected) ?? pool[0]
  }

  /**
   * Get all instances {@link InstanceIdentifier} exist in this application.
   * This includes all internal and public instances as well as plugins and utilities.
   */
  public getAllInstancesIdentifiers(): InstanceIdentifier[] {
    return this.getAllInstances().map((instance) => ({
      instanceName: instance.instanceName,
      instanceType: instance.instanceType
    }))
  }

  private instanceByName(name: string): AllInstances | undefined {
    return this.getAllInstances().find((instance) => instance.instanceName.toLowerCase() === name.toLowerCase())
  }

  private applyStoredLanguage(): void {
    let selectedLanguage = this.core.languageConfigurations.getLanguage()
    if (!Object.values(ApplicationLanguages).includes(selectedLanguage)) {
      this.logger.warn(`Saved language '${selectedLanguage}' is not supported.`)
      this.logger.info(`Switching to default language '${LanguageConfigurations.DefaultLanguage}'.`)
      selectedLanguage = LanguageConfigurations.DefaultLanguage
    }

    this.changeLanguage(selectedLanguage)
  }

  private getAllInstances(): AllInstances[] {
    const instances = [
      ...this.pluginsManager.getAllInstances(),
      this.core,
      this.applicationIntegrity,

      this.discordInstance, // discord second to send any notification about connecting

      this.prometheusInstance,
      this.webServer,
      this.commandsInstance,
      ...this.minecraftManager.getAllInstances(),
      this.skyblockReminders,
      this.hypixelUpdates,
      this.spontaneousEvents,
      this.statMonitor,
      this.randomChatter,
      this.autoRestart
    ].filter((instance) => instance != undefined)

    this.applicationIntegrity.checkLocalInstancesIntegrity(instances)
    return instances
  }
}
