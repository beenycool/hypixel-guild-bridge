import type Application from '../../../application.js'

import ArabicFixer from './arabic-fixer.js'
import EmojiSanitizer from './emoji-sanitizer.js'
import EzSanitizer from './ez-sanitizer.js'
import LineSanitizer from './line-sanitizer.js'
import { LinksSanitizer } from './links-sanitizer.js'

export class Sanitizer {
  private readonly line: LineSanitizer
  private readonly link: LinksSanitizer
  private readonly emoji: EmojiSanitizer
  private readonly ez: EzSanitizer
  private readonly arabicFixer: ArabicFixer

  constructor(application: Application) {
    this.line = new LineSanitizer()
    this.link = new LinksSanitizer(application.core.minecraftConfigurations, application.openrouterApiKey)
    this.emoji = new EmojiSanitizer()
    this.ez = new EzSanitizer()
    this.arabicFixer = new ArabicFixer()
  }

  public async sanitizeChatMessage(
    instanceName: string,
    message: string,
    options?: { maxDescriptionLength?: number }
  ): Promise<string> {
    message = this.line.process(message)
    message = await this.link.process(message, options)
    message = this.emoji.process(message)
    message = this.ez.process(message)
    message = this.arabicFixer.encode(message)

    return message
  }

  public sanitizeGenericCommand(message: string): string {
    return this.line.process(message)
  }
}
