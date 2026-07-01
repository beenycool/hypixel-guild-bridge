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
      bridgeId === undefined ? undefined : context.app.core.bridgeConfigurations.getInsultMode(bridgeId)
    const i18nKey = insultMode === 'custom' ? 'commands.insult' : 'commands.insult.normal'

    let messages = context.app.i18n.t(($) => $[i18nKey], { returnObjects: true, name: givenUsername })
    context.logger.debug(
      `[insult] bridgeId=${bridgeId} mode=${insultMode} key=${i18nKey} isArray=${Array.isArray(messages)} len=${Array.isArray(messages) ? messages.length : 'N/A'} type=${typeof messages}`
    )

    if (!Array.isArray(messages) || messages.length === 0) {
      messages = context.app.i18n.t(($) => $['commands.insult'], { returnObjects: true, name: givenUsername })
      context.logger.debug(
        `[insult] fallback key=commands.insult isArray=${Array.isArray(messages)} len=${Array.isArray(messages) ? messages.length : 'N/A'} type=${typeof messages}`
      )
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      context.logger.debug(`[insult] no insults found for any key`)
      return `${givenUsername}, you're lucky there are no insults configured right now.`
    }

    let message = messages[Math.floor(Math.random() * messages.length)]
    message = message.replaceAll('{{name}}', givenUsername)

    return message
  }
}
