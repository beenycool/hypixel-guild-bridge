import type { Permission } from './application-event.js'
import { ConfigManager } from './config-manager.js'
import type Application from '../application.js'
import type { Logger } from 'log4js'

/**
 * Configuration for individual commands
 */
export interface CommandConfig {
  /** Original command name (for reference) */
  originalName: string
  /** Current display name */
  displayName: string
  /** Whether the command is enabled */
  enabled: boolean
  /** Command permission level */
  permission: Permission
  /** When the configuration was last modified */
  modifiedAt: number
  /** User ID who last modified this command */
  modifiedBy: string
}

/**
 * Complete command configuration structure
 */
export interface CommandConfiguration {
  /** Discord commands configuration by name */
  discord: Record<string, CommandConfig>
  /** Minecraft commands configuration by trigger */
  minecraft: Record<string, CommandConfig>
  /** Audit log of all command modifications */
  auditLog: CommandAuditLogEntry[]
}

/**
 * Audit log entry for command modifications
 */
export interface CommandAuditLogEntry {
  /** Unique ID for this audit entry */
  id: string
  /** Type of action performed */
  action: 'rename' | 'enable' | 'disable' | 'restore'
  /** Command type */
  commandType: 'discord' | 'minecraft'
  /** Command identifier (name or trigger) */
  commandIdentifier: string
  /** Old value (if applicable) */
  oldValue?: string
  /** New value (if applicable) */
  newValue?: string
  /** User ID who performed the action */
  userId: string
  /** Timestamp of the action */
  timestamp: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Manages command configurations and persist them to disk
 */
export class CommandConfigManager {
  private configManager: ConfigManager<CommandConfiguration>
  private application: Application
  private static readonly DEFAULT_CONFIG: CommandConfiguration = {
    discord: {},
    minecraft: {},
    auditLog: []
  }

  constructor(application: Application) {
    const configPath = application.getConfigFilePath('command-config.json')
    this.configManager = new ConfigManager(application, (application as any).logger, configPath, CommandConfigManager.DEFAULT_CONFIG)
    this.application = application
  }

  /**
   * Get configuration for a specific Discord command
   */
  public getDiscordCommandConfig(commandName: string): CommandConfig | null {
    return this.configManager.data.discord[commandName] || null
  }

  /**
   * Get configuration for a specific Minecraft command
   */
  public getMinecraftCommandConfig(trigger: string): CommandConfig | null {
    return this.configManager.data.minecraft[trigger] || null
  }

  /**
   * Get all Discord command configurations
   */
  public getAllDiscordConfigs(): Record<string, CommandConfig> {
    return { ...this.configManager.data.discord }
  }

  /**
   * Get all Minecraft command configurations
   */
  public getAllMinecraftConfigs(): Record<string, CommandConfig> {
    return { ...this.configManager.data.minecraft }
  }

  /**
   * Update or create Discord command configuration
   */
  public updateDiscordCommandConfig(
    commandName: string,
    updates: Partial<Omit<CommandConfig, 'originalName' | 'modifiedAt' | 'modifiedBy'>>,
    modifiedBy: string
  ): void {
    const existing = this.configManager.data.discord[commandName]
    const now = Date.now()

    if (existing) {
      // Update existing configuration
      this.configManager.data.discord[commandName] = {
        ...existing,
        ...updates,
        modifiedAt: now,
        modifiedBy
      }
    } else {
      // Create new configuration
      this.configManager.data.discord[commandName] = {
        originalName: commandName,
        displayName: updates.displayName || commandName,
        enabled: updates.enabled !== undefined ? updates.enabled : true,
        permission: updates.permission || 0, // Default to Anyone
        modifiedAt: now,
        modifiedBy
      }
    }

    this.configManager.markDirty()
  }

  /**
   * Update or create Minecraft command configuration
   */
  public updateMinecraftCommandConfig(
    trigger: string,
    updates: Partial<Omit<CommandConfig, 'originalName' | 'modifiedAt' | 'modifiedBy'>>,
    modifiedBy: string
  ): void {
    const existing = this.configManager.data.minecraft[trigger]
    const now = Date.now()

    if (existing) {
      // Update existing configuration
      this.configManager.data.minecraft[trigger] = {
        ...existing,
        ...updates,
        modifiedAt: now,
        modifiedBy
      }
    } else {
      // Create new configuration
      this.configManager.data.minecraft[trigger] = {
        originalName: trigger,
        displayName: updates.displayName || trigger,
        enabled: updates.enabled !== undefined ? updates.enabled : true,
        permission: updates.permission || 0, // Default to Anyone
        modifiedAt: now,
        modifiedBy
      }
    }

    this.configManager.markDirty()
  }

  /**
   * Add an audit log entry
   */
  public addAuditLogEntry(entry: Omit<CommandAuditLogEntry, 'id' | 'timestamp'>): void {
    const auditEntry: CommandAuditLogEntry = {
      ...entry,
      id: this.generateAuditId(),
      timestamp: Date.now()
    }

    this.configManager.data.auditLog.push(auditEntry)

    // Keep only the last 1000 audit entries to prevent file from growing too large
    if (this.configManager.data.auditLog.length > 1000) {
      this.configManager.data.auditLog = this.configManager.data.auditLog.slice(-1000)
    }

    this.configManager.markDirty()
  }

  /**
   * Get audit log entries for a specific command
   */
  public getAuditLogForCommand(commandType: 'discord' | 'minecraft', commandIdentifier: string): CommandAuditLogEntry[] {
    return this.configManager.data.auditLog.filter(
      entry => entry.commandType === commandType && entry.commandIdentifier === commandIdentifier
    ).slice(-50) // Last 50 entries for this command
  }

  /**
   * Get recent audit log entries
   */
  public getRecentAuditLog(limit = 100): CommandAuditLogEntry[] {
    return this.configManager.data.auditLog.slice(-limit)
  }

  /**
   * Check if a command is enabled (considering custom configuration)
   */
  public isCommandEnabled(commandType: 'discord' | 'minecraft', commandIdentifier: string): boolean {
    const config = commandType === 'discord' 
      ? this.getDiscordCommandConfig(commandIdentifier)
      : this.getMinecraftCommandConfig(commandIdentifier)
    
    return config ? config.enabled : true // Default to enabled if no custom config
  }

  /**
   * Get the display name for a command (considering custom configuration)
   */
  public getCommandDisplayName(commandType: 'discord' | 'minecraft', commandIdentifier: string): string {
    const config = commandType === 'discord' 
      ? this.getDiscordCommandConfig(commandIdentifier)
      : this.getMinecraftCommandConfig(commandIdentifier)
    
    return config ? config.displayName : commandIdentifier
  }

  /**
   * Get commands that should be filtered out for non-admin users
   */
  public getFilteredCommandsForPermission(
    commandType: 'discord' | 'minecraft',
    commands: Array<{ name: string; permission?: Permission }>,
    userPermission: Permission
  ): Array<{ name: string; permission?: Permission }> {
    return commands.filter(cmd => {
      // Check if command is disabled in config
      if (!this.isCommandEnabled(commandType, cmd.name)) {
        return false
      }
      
      // Apply permission filtering based on command's required permission vs user's permission
      const commandPermission = cmd.permission || 0 // Default to Anyone
      return userPermission >= commandPermission
    })
  }

  /**
   * Check if a command is protected (core admin commands that cannot be modified)
   */
  public isCommandProtected(commandType: 'discord' | 'minecraft', commandIdentifier: string): boolean {
    const protectedCommands = [
      // Core Discord admin commands
      'settings', 'commands', 'restart',
      // Core Minecraft admin commands (if any)
    ]

    return protectedCommands.includes(commandIdentifier.toLowerCase())
  }

  /**
   * Generate a unique audit ID
   */
  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Save configuration immediately
   */
  public save(): void {
    this.configManager.save()
  }

  /**
   * Get the underlying config manager for advanced operations
   */
  public getConfigManager(): ConfigManager<CommandConfiguration> {
    return this.configManager
  }
}