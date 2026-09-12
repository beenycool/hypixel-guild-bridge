import { hash } from 'node:crypto'

import NodeCache from 'node-cache'

import { InstanceType } from '../../../common/application-event.js'
import type { ChatCommandContext } from '../../../common/commands.js'
import { ChatCommandHandler } from '../../../common/commands.js'
import { canOnlyUseIngame } from '../common/utility'

export default class Unlink extends ChatCommandHandler {
  private readonly confirmationId = new NodeCache({ stdTTL: 60 })

  constructor() {
    super({
      category: 'Utility',
      triggers: ['unlink'],
      description: 'Unlink Minecraft account from Discord',
      example: 'unlink'
    })
  }

  async handler(context: ChatCommandContext): Promise<string> {
    const givenId = context.args[0] ?? ''

    if (context.message.instanceType !== InstanceType.Minecraft) {
      return canOnlyUseIngame(context)
    }

    const uuid = context.message.user.mojangProfile().id
    const bridgeId = context.message.bridgeId
    if (bridgeId === undefined) {
      return `${context.username}, This command must be run from a bridge-scoped chat.`
    }

    if (this.confirmationId.get<string>(givenId) === uuid) {
      const userLink = await context.app.core.verification.findByIngame(uuid, bridgeId)
      const count = context.app.core.verification.invalidate({ uuid: uuid, bridgeId: bridgeId })
      if (count > 0 && userLink) {
        try {
          await context.app.discordInstance.verificationRoleManager.updateUser(userLink.discordId, {
            uuid: userLink.uuid,
            bridgeId: bridgeId
          })
        } catch (error: unknown) {
          context.logger.error('Failed to sync verification roles after unlinking', error)
        }
      }
      return count > 0 ? `${context.username}, Successfully unlinked!` : `${context.username}, Nothing to Unlink!`
    } else {
      const userLink = await context.app.core.verification.findByIngame(uuid, bridgeId)
      if (userLink === undefined) {
        return `${context.username}, Nothing to Unlink!`
      }

      const id = this.createId()
      this.confirmationId.set(id, uuid)
      return `You are about to unlink your Minecraft account from Discord. To confirm do: ${context.commandPrefix}${this.triggers[0]} ${id}`
    }
  }

  private createId(): string {
    return hash('sha256', Math.random().toString(10)).slice(0, 10).toUpperCase()
  }
}
