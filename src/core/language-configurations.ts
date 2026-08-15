import {
  DefaultBlackjackDrawMessages,
  DefaultBlackjackLoseMessages,
  DefaultBlackjackWinMessages
} from '../common/constants/blackjack-defaults.js'
import { DefaultMuteMessages } from '../common/constants/mute-defaults.js'

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

  public getCommandMuteGame(): string[] {
    return this.configuration.getStringArray('commandMuteGame', DefaultMuteMessages)
  }

  public setCommandMuteGame(values: string[]): void {
    this.configuration.setStringArray('commandMuteGame', values)
  }

  public getCommandBlackjackWin(): string[] {
    return this.configuration.getStringArray('commandBlackjackWin', DefaultBlackjackWinMessages)
  }
  public setCommandBlackjackWin(values: string[]): void {
    this.configuration.setStringArray('commandBlackjackWin', values)
  }
  public getCommandBlackjackLose(): string[] {
    return this.configuration.getStringArray('commandBlackjackLose', DefaultBlackjackLoseMessages)
  }
  public setCommandBlackjackLose(values: string[]): void {
    this.configuration.setStringArray('commandBlackjackLose', values)
  }
  public getCommandBlackjackDraw(): string[] {
    return this.configuration.getStringArray('commandBlackjackDraw', DefaultBlackjackDrawMessages)
  }
  public setCommandBlackjackDraw(values: string[]): void {
    this.configuration.setStringArray('commandBlackjackDraw', values)
  }
}
