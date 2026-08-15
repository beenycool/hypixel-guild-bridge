import type { Configuration, ConfigurationsManager } from '../configurations'

export class ModerationConfigurations {
  private readonly configuration: Configuration

  constructor(manager: ConfigurationsManager) {
    this.configuration = manager.create('moderation')
  }

  public getProfanityWhitelist(): string[] {
    return this.configuration.getStringArray('profanityWhitelist', [
      'sadist',
      'hell',
      'damn',
      'god',
      'shit',
      'balls',
      'retard'
    ])
  }

  public setProfanityWhitelist(values: string[]): void {
    this.configuration.setStringArray('profanityWhitelist', values)
  }

  public getProfanityBlacklist(): string[] {
    return this.configuration.getStringArray('profanityBlacklist', [])
  }

  public setProfanityBlacklist(values: string[]): void {
    this.configuration.setStringArray('profanityBlacklist', values)
  }
}
