import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'

export default class Insult extends ChatCommandHandler {
  constructor() {
    super({
      triggers: ['insult'],
      description: 'insult a player',
      example: `insult %s`
    })
  }

  handler(context: ChatCommandContext): string {
    const givenUsername = context.args[0] ?? context.username

    const bridgeId = context.message.bridgeId
    const insultMode =
      bridgeId !== undefined ? context.app.core.bridgeConfigurations.getInsultMode(bridgeId) : undefined
    const i18nKey = insultMode === 'custom' ? 'commands.insult' : 'commands.insult.normal'

    let messages = context.app.i18n.t(($) => $[i18nKey], { returnObjects: true, name: givenUsername })
    if (!Array.isArray(messages) || messages.length === 0) {
      messages = context.app.i18n.t(($) => $['commands.insult'], { returnObjects: true, name: givenUsername })
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return `${givenUsername}, you're lucky there are no insults configured right now.`
    }

    let message = messages[Math.floor(Math.random() * messages.length)]
    message = message.replaceAll('{username}', givenUsername)

    return message
  }
}
