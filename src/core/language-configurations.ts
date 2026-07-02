import type { Configuration, ConfigurationsManager } from './configurations'

import { DefaultMuteMessages } from '../common/constants/mute-defaults.js'
import { DefaultRouletteWinMessages, DefaultRouletteLoseMessages } from '../common/constants/roulette-defaults.js'
import {
  DefaultVengeanceWinMessages,
  DefaultVengeanceDrawMessages,
  DefaultVengeanceLoseMessages
} from '../common/constants/vengeance-defaults.js'

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

  public getCommandRouletteWin(): string[] {
    return this.configuration.getStringArray('commandRouletteWin', DefaultRouletteWinMessages)
  }
  public setCommandRouletteWin(values: string[]): void {
    this.configuration.setStringArray('commandRouletteWin', values)
  }
  public getCommandRouletteLose(): string[] {
    return this.configuration.getStringArray('commandRouletteLose', DefaultRouletteLoseMessages)
  }
  public setCommandRouletteLose(values: string[]): void {
    this.configuration.setStringArray('commandRouletteLose', values)
  }

  public getCommandVengeanceWin(): string[] {
    return this.configuration.getStringArray('commandVengeanceWin', DefaultVengeanceWinMessages)
  }
  public setCommandVengeanceWin(values: string[]): void {
    this.configuration.setStringArray('commandVengeanceWin', values)
  }

  public getCommandVengeanceDraw(): string[] {
    return this.configuration.getStringArray('commandVengeanceDraw', DefaultVengeanceDrawMessages)
  }
  public setCommandVengeanceDraw(values: string[]): void {
    this.configuration.setStringArray('commandVengeanceDraw', values)
  }

  public getCommandVengeanceLose(): string[] {
    return this.configuration.getStringArray('commandVengeanceLose', DefaultVengeanceLoseMessages)
  }

  public setCommandVengeanceLose(values: string[]): void {
    this.configuration.setStringArray('commandVengeanceLose', values)
  }
}
