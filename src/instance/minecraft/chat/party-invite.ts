import { checkChatTriggers, PartyAcceptChat, PartyLeaveChat } from '../../../utility/chat-triggers.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'
import { findPartyInvite, updatePartyState } from '../common/party-state.js'

export { findPartyInvite, PartyInviteRegex, PartyJoinRegex, PartyLeaveRegex } from '../common/party-state.js'

interface PartyInviteModule extends MinecraftChatMessage {
  inParty: boolean
  cooldowns: Map<string, number>
}

export default {
  inParty: false,
  cooldowns: new Map<string, number>(),
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const message = context.message

    const partyRelated = /party|invit/i.test(message)
    if (partyRelated) {
      context.logger.info(
        `[party-invite] party-related message: "${message}" | raw: "${context.rawMessage}" | inParty=${this.inParty}`
      )
    }

    this.inParty = updatePartyState(message, this.inParty)

    const username = findPartyInvite(message)
    if (username == undefined) return

    context.logger.info(`[party-invite] invite detected from ${username} | message: "${message}"`)
    if (context.application.minecraftManager.isMinecraftBot(username)) {
      context.logger.info(`[party-invite] ignoring ${username}: is a bridge minecraft bot`)
      return
    }

    const cooldownUntil = this.cooldowns.get(username.toLowerCase())
    if (cooldownUntil != undefined && Date.now() < cooldownUntil) {
      context.logger.info(`[party-invite] ignoring ${username}: within cooldown`)
      return
    }

    const profile = await context.application.mojangApi
      .profileByUsername(username)
      .then((result) => result)
      .catch((error: unknown) => {
        context.logger.info(`[party-invite] failed to lookup ${username} on mojang: ${String(error)}`)
        return
      })
    if (profile == undefined) return

    const botUuid = context.clientInstance.uuid() ?? context.clientInstance.username()
    if (botUuid == undefined) {
      context.logger.info(`[party-invite] could not resolve own uuid/username`)
      return
    }

    const guild = await context.application.hypixelApi
      .getGuild('player', botUuid)
      .then((result) => result)
      .catch((error: unknown) => {
        context.logger.info(`[party-invite] failed to fetch guild: ${String(error)}`)
        return
      })
    if (guild == undefined) return

    const isGuildMember = guild.members.some(
      (member) => member.uuid.replaceAll('-', '').toLowerCase() === profile.id.replaceAll('-', '').toLowerCase()
    )
    context.logger.info(
      `[party-invite] ${username} (${profile.id}) is${isGuildMember ? '' : ' NOT'} a guild member (guild "${guild.name}", ${guild.members.length} members)`
    )
    if (!isGuildMember) return

    const accept = async (): Promise<void> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await checkChatTriggers(
          context.application,
          context.eventHelper,
          PartyAcceptChat,
          [context.instanceName],
          `/p accept ${username}`,
          username
        ).catch(() => undefined)
        if (result == undefined) {
          context.logger.info(`[party-invite] failed to confirm /p accept for ${username}`)
          return
        }

        const alreadyInParty = result.message.some((entry) => entry.content.includes('already in a party'))
        context.logger.info(
          `[party-invite] /p accept result for ${username}: status=${result.status}, messages=${JSON.stringify(result.message.map((entry) => entry.content))}`
        )
        if (result.status !== 'failed' || !alreadyInParty) {
          this.cooldowns.set(username.toLowerCase(), Date.now() + 30_000)
          return
        }

        context.logger.info(`[party-invite] ${username}: already in a party, leaving then retrying`)
        await checkChatTriggers(
          context.application,
          context.eventHelper,
          PartyLeaveChat,
          [context.instanceName],
          '/p leave',
          username
        ).catch(() => undefined)
      }
    }

    context.logger.info(`[party-invite] accepting invite from guild member ${username} (inParty=${this.inParty})`)
    if (this.inParty) {
      const leaveResult = await checkChatTriggers(
        context.application,
        context.eventHelper,
        PartyLeaveChat,
        [context.instanceName],
        '/p leave',
        username
      ).catch(() => undefined)
      context.logger.info(
        `[party-invite] /p leave result: ${leaveResult == undefined ? 'no confirmation' : `${leaveResult.status} ${JSON.stringify(leaveResult.message.map((entry) => entry.content))}`}`
      )
    }
    await accept()
  }
} satisfies PartyInviteModule
