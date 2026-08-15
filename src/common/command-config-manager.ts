import type { Logger } from 'log4js'
import Logger4Js from 'log4js'

import type Application from '../application.js'

import type { Permission } from './application-event.js'
import { ConfigManager } from './config-manager.js'

export interface CommandConfig {
  originalName: string

  displayName: string

  enabled: boolean

  permission: Permission

  modifiedAt: number

  modifiedBy: string
}

export interface CommandConfiguration {
  discord: Record<string, CommandConfig>

  minecraft: Record<string, CommandConfig>

  auditLog: CommandAuditLogEntry[]
}

export interface CommandAuditLogEntry {
  id: string

  action: 'rename' | 'enable' | 'disable' | 'restore'

  commandType: 'discord' | 'minecraft'

  commandIdentifier: string

  oldValue?: string

  newValue?: string

  userId: string

  timestamp: number

  metadata?: Record<string, unknown>
}

export class CommandConfigManager {
  private configManager: ConfigManager<CommandConfiguration>
  private application: Application
  private static readonly DefaultConfig: CommandConfiguration = {
    discord: {},
    minecraft: {},
    auditLog: []
  }

  constructor(application: Application) {
    const configPath = application.getConfigFilePath('command-config.json')
    const logger: Logger = Logger4Js.getLogger('CommandConfig')
    this.configManager = new ConfigManager(application, logger, configPath, CommandConfigManager.DefaultConfig)
    this.application = application
  }

  public getDiscordCommandConfig(commandName: string): CommandConfig | undefined {
    return Object.hasOwn(this.configManager.data.discord, commandName)
      ? this.configManager.data.discord[commandName]
      : undefined
  }

  public getMinecraftCommandConfig(trigger: string): CommandConfig | undefined {
    return Object.hasOwn(this.configManager.data.minecraft, trigger)
      ? this.configManager.data.minecraft[trigger]
      : undefined
  }

  public getAllDiscordConfigs(): Record<string, CommandConfig> {
    return { ...this.configManager.data.discord }
  }

  public getAllMinecraftConfigs(): Record<string, CommandConfig> {
    return { ...this.configManager.data.minecraft }
  }

  public updateDiscordCommandConfig(
    commandName: string,
    updates: Partial<Omit<CommandConfig, 'originalName' | 'modifiedAt' | 'modifiedBy'>>,
    modifiedBy: string
  ): void {
    const now = Date.now()

    if (Object.hasOwn(this.configManager.data.discord, commandName)) {
      const existing = this.configManager.data.discord[commandName]
      this.configManager.data.discord[commandName] = {
        ...existing,
        ...updates,
        modifiedAt: now,
        modifiedBy
      }
    } else {
      this.configManager.data.discord[commandName] = {
        originalName: commandName,
        displayName: updates.displayName ?? commandName,
        enabled: updates.enabled ?? true,
        permission: updates.permission ?? 0,
        modifiedAt: now,
        modifiedBy
      }
    }

    this.configManager.markDirty()
  }

  public updateMinecraftCommandConfig(
    trigger: string,
    updates: Partial<Omit<CommandConfig, 'originalName' | 'modifiedAt' | 'modifiedBy'>>,
    modifiedBy: string
  ): void {
    const now = Date.now()

    if (Object.hasOwn(this.configManager.data.minecraft, trigger)) {
      const existing = this.configManager.data.minecraft[trigger]
      this.configManager.data.minecraft[trigger] = {
        ...existing,
        ...updates,
        modifiedAt: now,
        modifiedBy
      }
    } else {
      this.configManager.data.minecraft[trigger] = {
        originalName: trigger,
        displayName: updates.displayName ?? trigger,
        enabled: updates.enabled ?? true,
        permission: updates.permission ?? 0,
        modifiedAt: now,
        modifiedBy
      }
    }

    this.configManager.markDirty()
  }

  public addAuditLogEntry(entry: Omit<CommandAuditLogEntry, 'id' | 'timestamp'>): void {
    const auditEntry: CommandAuditLogEntry = {
      ...entry,
      id: this.generateAuditId(),
      timestamp: Date.now()
    }

    this.configManager.data.auditLog.push(auditEntry)

    if (this.configManager.data.auditLog.length > 1000) {
      this.configManager.data.auditLog = this.configManager.data.auditLog.slice(-1000)
    }

    this.configManager.markDirty()
  }

  public getAuditLogForCommand(
    commandType: 'discord' | 'minecraft',
    commandIdentifier: string
  ): CommandAuditLogEntry[] {
    return this.configManager.data.auditLog
      .filter((entry) => entry.commandType === commandType && entry.commandIdentifier === commandIdentifier)
      .slice(-50)
  }

  public getRecentAuditLog(limit = 100): CommandAuditLogEntry[] {
    return this.configManager.data.auditLog.slice(-limit)
  }

  public isCommandEnabled(commandType: 'discord' | 'minecraft', commandIdentifier: string): boolean {
    const config =
      commandType === 'discord'
        ? this.getDiscordCommandConfig(commandIdentifier)
        : this.getMinecraftCommandConfig(commandIdentifier)

    return config ? config.enabled : true
  }

  public getCommandDisplayName(commandType: 'discord' | 'minecraft', commandIdentifier: string): string {
    const config =
      commandType === 'discord'
        ? this.getDiscordCommandConfig(commandIdentifier)
        : this.getMinecraftCommandConfig(commandIdentifier)

    return config ? config.displayName : commandIdentifier
  }

  public getFilteredCommandsForPermission(
    commandType: 'discord' | 'minecraft',
    commands: { name: string; permission?: Permission }[],
    userPermission: Permission
  ): { name: string; permission?: Permission }[] {
    return commands.filter((cmd) => {
      if (!this.isCommandEnabled(commandType, cmd.name)) {
        return false
      }

      const commandPermission = cmd.permission ?? 0
      return userPermission >= commandPermission
    })
  }

  public isCommandProtected(commandType: 'discord' | 'minecraft', commandIdentifier: string): boolean {
    const protectedCommands = ['settings', 'commands', 'restart']

    return protectedCommands.includes(commandIdentifier.toLowerCase())
  }

  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  public save(): void {
    this.configManager.save()
  }

  public getConfigManager(): ConfigManager<CommandConfiguration> {
    return this.configManager
  }
}
