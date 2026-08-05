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

export function findPartyInvite(message: string): string | undefined {
  for (const line of message.split('\n')) {
    for (const regex of PartyInviteRegex) {
      const match = regex.exec(line)
      if (match != undefined) return match[1]
    }
  }
  return undefined
}

function matchesAny(message: string, regexes: RegExp[]): boolean {
  return message.split('\n').some((line) => regexes.some((regex) => regex.test(line)))
}

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

    if (matchesAny(message, PartyJoinRegex)) this.inParty = true
    if (matchesAny(message, PartyLeaveRegex)) this.inParty = false

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
