import assert from 'node:assert'

import BadWords from 'bad-words'

import type { ModerationConfigurations } from './moderation-configurations'

export class Profanity {
  public profanityFilter: BadWords

  constructor(private readonly config: ModerationConfigurations) {
    this.profanityFilter = this.createFilter()
  }

  private createFilter(): BadWords {
    const profanityFilter = new BadWords()
    profanityFilter.removeWords(...this.config.getProfanityWhitelist())
    profanityFilter.addWords(...this.config.getProfanityBlacklist())

    return profanityFilter
  }

  public reloadProfanity(): void {
    this.profanityFilter = this.createFilter()
  }

  private censorWord(word: string): string {
    return word.replaceAll(/[aeiou]/gi, '*')
  }

  public filterProfanity(message: string): { filteredMessage: string; changed: boolean } {
    if (!this.config.getProfanityEnabled()) return { filteredMessage: message, changed: false }
    assert.ok(this.profanityFilter)

    let changed = false
    let filtered: string
    try {
      filtered = message.replaceAll(/\w+/g, (word) => {
        if (this.profanityFilter.isProfane(word)) {
          changed = true
          return this.censorWord(word)
        }
        return word
      })
    } catch {
      filtered = message
    }

    return { filteredMessage: filtered, changed }
  }
}
