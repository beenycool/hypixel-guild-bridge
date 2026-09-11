import type Application from '../../../application.js'

import EmojiSanitizer from './emoji-sanitizer.js'
import { LinksSanitizer } from './links-sanitizer.js'

export function lineSanitize(message: string): string {
  return message.replaceAll(/\s*\n\s*/g, ' ').trim()
}

export function ezSanitize(message: string): string {
  const regex = /(?<!\w)ez(?!\w)/g
  return message.replaceAll(regex, '_ez')
}

export function dotSanitize(message: string): string {
  return message.replaceAll(/(?<!\d)\.(?!\d)/g, '')
}

export class Sanitizer {
  private readonly link: LinksSanitizer
  private readonly emoji: EmojiSanitizer

  constructor(application: Application) {
    this.link = new LinksSanitizer(application.openrouterApiKey)
    this.emoji = new EmojiSanitizer()
  }

  public async sanitizeChatMessage(
    instanceName: string,
    message: string,
    options?: { maxDescriptionLength?: number }
  ): Promise<string> {
    message = lineSanitize(message)
    message = await this.link.process(message, options)
    message = this.emoji.process(message)
    message = ezSanitize(message)
    message = dotSanitize(message)

    return message
  }

  public sanitizeGenericCommand(message: string): string {
    message = lineSanitize(message)
    message = dotSanitize(message)
    return message
  }

  public sanitizeDots(message: string): string {
    return dotSanitize(message)
  }
}
