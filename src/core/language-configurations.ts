import type { Configuration, ConfigurationsManager } from './configurations'

export enum ApplicationLanguages {
  English = 'en',
  Arabic = 'ar'
}

export class LanguageConfigurations {
  public static readonly DefaultLanguage = ApplicationLanguages.English
  private readonly configuration: Configuration

  constructor(manager: ConfigurationsManager) {
    this.configuration = manager.create('language')
  }

  public getLanguage(): ApplicationLanguages {
    return this.configuration.getString('language', LanguageConfigurations.DefaultLanguage) as ApplicationLanguages
  }

  public setLanguage(language: ApplicationLanguages): void {
    this.configuration.setString('language', language)
  }
}
