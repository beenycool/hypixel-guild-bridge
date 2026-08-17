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
import UnexpectedErrorHandler from './common/unexpected-error-handler.js'
import { Core } from './core/core.js'
import { ApplicationLanguages, LanguageConfigurations } from './core/language-configurations.js'
import { LunarService } from './core/lunar/lunar-service.js'
import type { MojangApi } from './core/users/mojang'
import ApplicationIntegrity from './instance/application-integrity.js'
import AutoLinker from './instance/auto-linker.js'
import AutoRestart from './instance/auto-restart.js'
import { ChatSummaryScheduler } from './instance/chat-summary-scheduler'
import { CommandsInstance } from './instance/commands/commands-instance.js'
import DiscordInstance from './instance/discord/discord-instance.js'
import MinecraftInstance from './instance/minecraft/minecraft-instance.js'
import { MinecraftManager } from './instance/minecraft/minecraft-manager.js'
import type ApplicationMetrics from './instance/prometheus/application-metrics.js'
import PrometheusInstance from './instance/prometheus/prometheus-instance.js'
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
  | ApplicationIntegrity
  | AutoLinker
  | StatMonitor
  | AutoRestart
  | MinecraftManager
  | ChatSummaryScheduler

export default class Application extends Emittery<ApplicationEvents> implements InstanceIdentifier {
  public readonly instanceName: string = InstanceType.Main
  public readonly instanceType: InstanceType = InstanceType.Main

  public readonly applicationIntegrity: ApplicationIntegrity

  public readonly hypixelApi: HypixelClient
  public readonly mojangApi: MojangApi
  public readonly lunarService: LunarService

  public get hypixelApiKey(): string {
    return this.config.general.hypixelApiKey
  }

  public get urchinApiKey(): string | undefined {
    return this.core.appSettings.getUrchinApiKey()
  }

  public get seraphApiKey(): string | undefined {
    return this.core.appSettings.getSeraphApiKey()
  }

  public get openrouterApiKey(): string | undefined {
    return this.core.appSettings.getOpenrouterApiKey()
  }

  public get openrouterModel(): string | undefined {
    return this.core.appSettings.getOpenrouterModel()
  }

  public get chatSummarySchedulerInstance(): ChatSummaryScheduler {
    return this.chatSummaryScheduler
  }

  public getDatabaseConfig(): DatabaseConfig | undefined {
    return this.config.database
  }

  public readonly logger: Logger
  private readonly errorHandler: UnexpectedErrorHandler
  private readonly shutdownListeners: (() => void | Promise<void>)[] = []

  public readonly rootDirectory: string
  private readonly configsDirectory
  private readonly backupDirectory
  public readonly config: Readonly<ApplicationConfig>

  public readonly discordInstance: DiscordInstance
  public readonly minecraftManager: MinecraftManager
  public readonly commandsInstance: CommandsInstance
  public core: Core
  public readonly bridgeResolver: BridgeResolver
  private readonly prometheusInstance: PrometheusInstance | undefined
  private readonly webServer: WebServer | undefined

  private readonly chatSummaryScheduler: ChatSummaryScheduler
  public readonly statMonitor: StatMonitor
  private readonly autoLinker: AutoLinker
  private readonly autoRestart: AutoRestart

  public get metrics(): ApplicationMetrics | undefined {
    return this.prometheusInstance?.applicationMetrics
  }

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
    this.bridgeResolver = new BridgeResolver()

    this.bridgeResolver.setDynamicConfig(this.core.bridgeConfigurations)

    this.discordInstance = new DiscordInstance(this, this.config.discord)

    this.minecraftManager = new MinecraftManager(this)

    this.prometheusInstance = this.config.prometheus.enabled
      ? new PrometheusInstance(this, this.config.prometheus)
      : undefined
    this.webServer = this.config.web?.enabled ? new WebServer(this, this.config.web) : undefined
    this.commandsInstance = new CommandsInstance(this)

    this.chatSummaryScheduler = new ChatSummaryScheduler(this)
    this.statMonitor = new StatMonitor(this)
    this.autoRestart = new AutoRestart(this)
    this.autoLinker = new AutoLinker(this)

    const defaultAccount = process.env.CLIENT_MINECRAFT_INSTANCE ?? 'percy_cookie'

    this.lunarService = new LunarService(
      this,
      this.logger,
      this.config.lunarClient?.minecraftInstance ?? defaultAccount,
      this.config.lunarClient?.cacheSeconds
    )

    this.on('minecraftSelfBroadcast', () => {
      void this.lunarService.ensureConnected().catch(() => undefined)
    })
  }

  public get auroraApiKey(): string | undefined {
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

  public getTranslatorForBridge(bridgeId?: string): TranslatorFunction {
    let dynamicLang: string | undefined
    let overrides: Record<string, string> = {}
    if (bridgeId !== undefined) {
      dynamicLang = this.core.bridgeConfigurations.getLanguage(bridgeId)
      overrides = this.core.bridgeConfigurations.getTranslationOverrides(bridgeId)
    }

    const chosenLang = dynamicLang

    const translate = (
      keyOrSelector: string | ((t: (key: string) => string) => string),
      options?: Record<string, unknown>
    ): string => {
      if (typeof keyOrSelector === 'string') {
        const override = overrides[keyOrSelector]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (override !== undefined) return override
      }
      return (this.i18n.t as unknown as TranslatorFunction)(keyOrSelector, {
        ...options,
        ...(chosenLang ? { lng: chosenLang } : {})
      })
    }
    return translate as TranslatorFunction
  }

  public async start(): Promise<void> {
    await this.core.awaitReady()
    await this.core.tournamentManager.rehydrate()
    this.bridgeResolver.rebuildLookupMaps()
    this.applyStoredLanguage()
    this.minecraftManager.loadInstances()

    for (const instance of this.getAllInstances()) {
      const checkedInstance = instance

      if (checkedInstance instanceof ConnectableInstance) {
        await checkedInstance.connect()
      }
    }

    try {
      const bridgeIds = this.core.bridgeConfigurations.getAllBridgeIds()
      for (const bridgeId of bridgeIds) {
        const existing = this.core.bridgeConfigurations.getGuildName(bridgeId)
        if (existing) continue

        const instanceNames = this.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
        if (instanceNames.length === 0) continue

        const botInstance = this.minecraftManager
          .getAllInstances()
          .find((inst) => instanceNames.some((n) => n.toLowerCase() === inst.instanceName.toLowerCase()))

        if (!botInstance) continue

        const botUuid = botInstance.uuid()
        if (!botUuid) continue

        try {
          const guild = await this.hypixelApi.getGuild('player', botUuid)
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (guild?.name) {
            this.core.bridgeConfigurations.setGuildName(bridgeId, guild.name)
            this.logger.info(`Resolved guild for bridge ${bridgeId}: ${guild.name}`)
          }
        } catch (error: unknown) {
          this.logger.warn(`Failed to resolve guild for bridge ${bridgeId}: ${String(error)}`)
        }
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to resolve guild names: ${String(error)}`)
    }

    try {
      this.chatSummaryScheduler.start()
    } catch (error: unknown) {
      this.errorHandler.promiseCatch('starting chat summary scheduler')(error)
    }
  }

  public async shutdown(): Promise<void> {
    for (const instance of this.getAllInstances().toReversed()) {
      if (instance instanceof ConnectableInstance && instance.currentStatus() !== Status.Fresh) {
        await instance.disconnect()
      }
    }

    await setImmediate()

    for (const shutdownListener of this.shutdownListeners.toReversed()) {
      await shutdownListener()
    }
  }

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
      this.core,
      this.applicationIntegrity,
      this.autoLinker,

      this.discordInstance,

      this.prometheusInstance,
      this.webServer,
      this.commandsInstance,
      ...this.minecraftManager.getAllInstances(),
      this.chatSummaryScheduler,
      this.statMonitor,
      this.autoRestart
    ].filter((instance) => instance != undefined)

    this.applicationIntegrity.checkLocalInstancesIntegrity(instances)
    return instances
  }
}
