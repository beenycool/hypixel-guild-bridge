import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Praise extends ChatCommandHandler {
  constructor() {
    super({
      category: 'Fun',
      triggers: ['praise'],
      description: 'praise a player',
      example: `praise %s`
    })
  }

  handler(context: ChatCommandContext): string {
    const givenUsername = context.args[0] ?? context.username

    if (Math.random() <= 0.01) {
      const bridgeId = context.message.bridgeId
      const insultMode =
        bridgeId === undefined ? undefined : context.app.core.bridgeConfigurations.getInsultMode(bridgeId)
      const i18nKey = insultMode === 'custom' ? 'commands.insult' : 'commands.insult.normal'
      const messages = context.app.i18n.t(($) => $[i18nKey], { returnObjects: true, name: givenUsername })
      let message = messages[Math.floor(Math.random() * messages.length)]
      message = message.replaceAll('{{name}}', givenUsername)
      return message
    }

    const messages = context.app.i18n.t(($) => $['commands.praise'], { returnObjects: true, name: givenUsername })
    let message = messages[Math.floor(Math.random() * messages.length)]
    message = message.replaceAll('{{name}}', givenUsername)
    return message
  }
}
