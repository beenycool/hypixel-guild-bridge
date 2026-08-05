import { checkChatTriggers, PartyAcceptChat, PartyLeaveChat } from '../../../utility/chat-triggers.js'
import type { MinecraftChatContext, MinecraftChatMessage } from '../common/chat-interface.js'

export const PartyInviteRegex = [
  /^(?:\[[+A-Z]{3,10}] ){0,3}(\w{3,32}) has invited you to join their party!/,
  /^You have been invited to join (?:\[[+A-Z]{3,10}] ){0,3}(\w{3,32})'s party!/
]

export const PartyJoinRegex = [/^Party created!/, /^You are now in a party with /, /^You joined .*'s party\./]

export const PartyLeaveRegex = [
  /^You left the party\./,
  /^The party was disbanded\./,
  /^You have been kicked from the party\./
]

interface PartyInviteModule extends MinecraftChatMessage {
  inParty: boolean
  cooldowns: Map<string, number>
}

export default {
  inParty: false,
  cooldowns: new Map<string, number>(),
  onChat: async function (context: MinecraftChatContext): Promise<void> {
    const message = context.message

    if (PartyJoinRegex.some((regex) => regex.test(message))) this.inParty = true
    if (PartyLeaveRegex.some((regex) => regex.test(message))) this.inParty = false

    let inviteMatch: RegExpExecArray | undefined
    for (const regex of PartyInviteRegex) {
      const match = regex.exec(message)
      if (match != undefined) {
        inviteMatch = match
        break
      }
    }
    if (inviteMatch == undefined) return

    const username = inviteMatch[1]
    if (context.application.minecraftManager.isMinecraftBot(username)) return

    const cooldownUntil = this.cooldowns.get(username.toLowerCase())
    if (cooldownUntil != undefined && Date.now() < cooldownUntil) return

    const profile = await context.application.mojangApi.profileByUsername(username).catch(() => undefined)
    if (profile == undefined) return

    const botUuid = context.clientInstance.uuid() ?? context.clientInstance.username()
    if (botUuid == undefined) return

    const guild = await context.application.hypixelApi.getGuild('player', botUuid).catch(() => undefined)
    if (guild == undefined) return

    const isGuildMember = guild.members.some(
      (member) => member.uuid.replaceAll('-', '').toLowerCase() === profile.id.replaceAll('-', '').toLowerCase()
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
        if (result == undefined) return

        const alreadyInParty = result.message.some((entry) => entry.content.includes('already in a party'))
        if (result.status !== 'failed' || !alreadyInParty) {
          context.logger.info(
            `Auto-accepted party invite from guild member ${username} (status: ${result.status}, ${result.message[0]?.content ?? 'no response'})`
          )
          this.cooldowns.set(username.toLowerCase(), Date.now() + 30_000)
          return
        }

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

    context.logger.info(`Received party invite from guild member ${username}`)
    if (this.inParty) {
      await checkChatTriggers(
        context.application,
        context.eventHelper,
        PartyLeaveChat,
        [context.instanceName],
        '/p leave',
        username
      ).catch(() => undefined)
    }
    await accept()
  }
} satisfies PartyInviteModule
