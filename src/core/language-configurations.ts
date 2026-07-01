import type { Configuration, ConfigurationsManager } from './configurations'

import { DefaultMuteMessages } from '../common/constants/mute-defaults.js'
import { DefaultRouletteWinMessages, DefaultRouletteLoseMessages } from '../common/constants/roulette-defaults.js'
import {
  DefaultVengeanceWinMessages,
  DefaultVengeanceDrawMessages,
  DefaultVengeanceLoseMessages
} from '../common/constants/vengeance-defaults.js'
import {
  DefaultReactionJoinMessages,
  DefaultReactionLeaveMessages,
  DefaultReactionKickMessages
} from '../common/constants/reaction-defaults.js'
import { DefaultPlayerMutedMessage } from '../common/constants/player-muted-defaults.js'
import { DefaultDarkAuctionMessage, DefaultStarfallMessage } from '../common/constants/skyblock-reminders-defaults.js'

export enum ApplicationLanguages {
  English = 'en',
  German = 'de',
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

  public getDarkAuctionReminder(): string {
    return this.configuration.getString('darkAuctionReminder', DefaultDarkAuctionMessage)
  }

  public setDarkAuctionReminder(darkAuctionReminder: string): void {
    this.configuration.setString('darkAuctionReminder', darkAuctionReminder)
  }

  public getStarfallReminder(): string {
    return this.configuration.getString('starfallReminder', DefaultStarfallMessage)
  }

  public setStarfallReminder(starfallReminder: string): void {
    this.configuration.setString('starfallReminder', starfallReminder)
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

  public getAnnounceMutedPlayer(): string {
    return this.configuration.getString('announceMutedPlayer', DefaultPlayerMutedMessage)
  }

  public setAnnounceMutedPlayer(value: string): void {
    this.configuration.setString('announceMutedPlayer', value)
  }

  public getGuildJoinReaction(): string[] {
    return this.configuration.getStringArray('guildJoinReaction', DefaultReactionJoinMessages)
  }

  public setGuildJoinReaction(values: string[]): void {
    this.configuration.setStringArray('guildJoinReaction', values)
  }

  public getGuildLeaveReaction(): string[] {
    return this.configuration.getStringArray('guildLeaveReaction', DefaultReactionLeaveMessages)
  }

  public setGuildLeaveReaction(values: string[]): void {
    this.configuration.setStringArray('guildLeaveReaction', values)
  }

  public getGuildKickReaction(): string[] {
    return this.configuration.getStringArray('guildKickReaction', DefaultReactionKickMessages)
  }

  public setGuildKickReaction(values: string[]): void {
    this.configuration.setStringArray('guildKickReaction', values)
  }
}
