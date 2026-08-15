import type { Configuration, ConfigurationsManager } from '../configurations'

export class CommandsConfigurations {
  private static readonly DefaultCommandPrefix: string = '!'

  private readonly configuration: Configuration

  constructor(manager: ConfigurationsManager) {
    this.configuration = manager.create('commands')
  }

  public getCommandsEnabled(): boolean {
    return this.configuration.getBoolean('enabled', true)
  }

  public setCommandsEnabled(enabled: boolean): void {
    this.configuration.setBoolean('enabled', enabled)
  }

  public getChatPrefix(): string {
    return this.configuration.getString('chatPrefix', CommandsConfigurations.DefaultCommandPrefix)
  }

  public setChatPrefix(prefix: string): void {
    this.configuration.setString('chatPrefix', prefix)
  }

  public getDisabledCommands(): string[] {
    return this.configuration.getStringArray('disabledCommands', [])
  }

  public setDisabledCommands(disabledCommands: string[]): void {
    this.configuration.setStringArray('disabledCommands', disabledCommands)
  }

  public getExplainCommandOnHelp(): boolean {
    return this.configuration.getBoolean('explainCommandOnHelp', true)
  }

  public setExplainCommandOnHelp(enabled: boolean): void {
    this.configuration.setBoolean('explainCommandOnHelp', enabled)
  }

  public getSuggestOnTypo(): boolean {
    return this.configuration.getBoolean('suggestOnTypo', true)
  }

  public setSuggestOnTypo(enabled: boolean): void {
    this.configuration.setBoolean('suggestOnTypo', enabled)
  }

  public getTypoSuggestionThreshold(): number {
    return this.configuration.getNumber('typoSuggestionThreshold', 0.6)
  }

  public setTypoSuggestionThreshold(threshold: number): void {
    this.configuration.setNumber('typoSuggestionThreshold', threshold)
  }

  public getTypoCooldownSeconds(): number {
    return this.configuration.getNumber('typoCooldownSeconds', 30)
  }

  public setTypoCooldownSeconds(seconds: number): void {
    this.configuration.setNumber('typoCooldownSeconds', seconds)
  }

  public getPassthroughCommands(): string[] {
    return this.configuration.getStringArray('passthroughCommands', [])
  }

  public setPassthroughCommands(commands: string[]): void {
    this.configuration.setStringArray('passthroughCommands', commands)
  }

  public getPassthroughPrefix(): string {
    return this.configuration.getString('passthroughPrefix', '!')
  }

  public setPassthroughPrefix(prefix: string): void {
    this.configuration.setString('passthroughPrefix', prefix)
  }

  public getQMutedUsers(): { username: string; expirationTime: number }[] {
    const entries = this.configuration.getStringArray('qMutedUsers', [])
    return entries.map((entry) => {
      const parts = entry.split(':')
      const username = parts[0] ?? ''
      const expirationTime = Number.parseInt(parts[1] ?? '0', 10)
      return { username, expirationTime }
    })
  }

  public addQMutedUser(username: string, expirationTime: number): void {
    const entries = this.getQMutedUsers()
    const filtered = entries.filter((entry) => entry.username.toLowerCase() !== username.toLowerCase())
    filtered.push({ username, expirationTime })

    const serialized = filtered.map((entry) => `${entry.username}:${entry.expirationTime}`)
    this.configuration.setStringArray('qMutedUsers', serialized)
  }

  public removeQMutedUser(username: string): void {
    const entries = this.getQMutedUsers()
    const filtered = entries.filter((entry) => entry.username.toLowerCase() !== username.toLowerCase())

    const serialized = filtered.map((entry) => `${entry.username}:${entry.expirationTime}`)
    this.configuration.setStringArray('qMutedUsers', serialized)
  }
}
