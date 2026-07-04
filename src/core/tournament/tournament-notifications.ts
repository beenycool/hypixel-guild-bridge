import { EmbedBuilder } from 'discord.js'

import type Application from '../../application.js'
import { MinecraftSendChatPriority } from '../../common/application-event.js'
import { Status } from '../../common/connectable-instance.js'

import type { Tournament, TournamentMatch } from './types.js'

export class TournamentNotifications {
  constructor(private readonly application: Application) {}

  /**
   * Helper to get a connected Minecraft instance for the bridge.
   */
  private getConnectedMinecraftInstance(bridgeId: string) {
    const instances = this.application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
    for (const name of instances) {
      const inst = this.application.minecraftManager
        .getAllInstances()
        .find((index) => index.instanceName.toLowerCase() === name.toLowerCase())
      if (inst && inst.currentStatus() === Status.Connected) {
        return inst
      }
    }
    // Fallback: any connected instance if none specifically mapped or connected
    return this.application.minecraftManager
      .getAllInstances()
      .find((index) => index.currentStatus() === Status.Connected)
  }

  /**
   * Sends a whisper to a player.
   */
  public async sendWhisper(bridgeId: string, playerUuid: string, message: string): Promise<boolean> {
    const announceMc = this.application.core.bridgeConfigurations.getTournamentAnnounceMc(bridgeId)
    if (!announceMc) return false

    // Resolve name from uuid
    const profile = await this.application.mojangApi.profileByUuid(playerUuid).catch(() => undefined)
    if (!profile) return false

    const inst = this.getConnectedMinecraftInstance(bridgeId)
    if (!inst) return false

    try {
      await inst.send(`/msg ${profile.name} ${message}`, MinecraftSendChatPriority.Default, undefined)
      return true
    } catch {
      return false
    }
  }

  /**
   * Sends a public guild chat announcement.
   */
  public async announceToGuild(bridgeId: string, message: string): Promise<void> {
    const announceMc = this.application.core.bridgeConfigurations.getTournamentAnnounceMc(bridgeId)
    if (!announceMc) return

    const inst = this.getConnectedMinecraftInstance(bridgeId)
    if (!inst) return

    try {
      await inst.send(`/gc ${message}`, MinecraftSendChatPriority.Default, undefined)
    } catch {
      // ignore errors
    }
  }

  /**
   * Sends a Discord announcement embed to the configured tournament notification channel.
   */
  public async announceToDiscord(bridgeId: string, embed: EmbedBuilder): Promise<void> {
    const channelId = this.application.core.bridgeConfigurations.getTournamentNotificationChannelId(bridgeId)
    if (!channelId) return

    const client = this.application.discordInstance.getClient()
    const channel = await client.channels.fetch(channelId).catch(() => undefined)
    if (channel?.isSendable()) {
      await channel.send({ embeds: [embed] }).catch(() => undefined)
    }
  }

  /**
   * Notify players of a match starting (MC whisper + Discord thread ping).
   */
  public async notifyMatchStart(
    bridgeId: string,
    match: TournamentMatch,
    p1Uuid: string,
    p2Uuid: string,
    p1Name: string,
    p2Name: string
  ): Promise<void> {
    const mcMessage = `🏆 Tournament: Your Round ${match.round} match against ${p2Name} is active! Check Discord for details.`
    await this.sendWhisper(bridgeId, p1Uuid, mcMessage)

    const mcMessage2 = `🏆 Tournament: Your Round ${match.round} match against ${p1Name} is active! Check Discord for details.`
    await this.sendWhisper(bridgeId, p2Uuid, mcMessage2)
  }

  /**
   * Sends a 24-hour warning for an active match.
   */
  public async sendDeadlineWarning(
    bridgeId: string,
    match: TournamentMatch,
    p1Uuid: string,
    p2Uuid: string,
    p1Name: string,
    p2Name: string
  ): Promise<void> {
    // 1. MC Whispers
    const mcMessage = `⚠️ Tournament: Your match against ${p2Name} is due in 24 hours! Please complete and report it.`
    await this.sendWhisper(bridgeId, p1Uuid, mcMessage)

    const mcMessage2 = `⚠️ Tournament: Your match against ${p1Name} is due in 24 hours! Please complete and report it.`
    await this.sendWhisper(bridgeId, p2Uuid, mcMessage2)

    // 2. Discord Thread Announcement
    if (match.discordThreadId) {
      const client = this.application.discordInstance.getClient()
      const thread = await client.channels.fetch(match.discordThreadId).catch(() => undefined)
      if (thread?.isSendable()) {
        const embed = new EmbedBuilder()
          .setTitle('⏳ Match Deadline Approaching')
          .setColor('#FFA500')
          .setDescription(
            `⚠️ This match must be played and reported within **24 hours**!\n\nIf the deadline expires without reports, the winner will be determined by seeds or available reports.`
          )
          .setTimestamp()

        await thread.send({ embeds: [embed] }).catch(() => undefined)
      }
    }
  }

  /**
   * Alert officers/admins to a dispute.
   */
  public async notifyDispute(
    bridgeId: string,
    match: TournamentMatch,
    p1Name: string,
    p2Name: string,
    r1ClaimedWinner: string,
    r2ClaimedWinner: string
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🚨 Match Disputed')
      .setColor('#FF0000')
      .setDescription(
        `A match in Round ${match.round} between **${p1Name}** and **${p2Name}** has conflicting reports:\n\n` +
          `• **${p1Name}** reported: ${r1ClaimedWinner} won\n` +
          `• **${p2Name}** reported: ${r2ClaimedWinner} won\n\n` +
          `An officer/admin must resolve this using \`/tournament confirm match_id:${match.id} winner:[winner_name]\`.` +
          `\n\n📷 **Proof posted:** ${match.hadProofAttachment ? '✅ Yes' : '❌ No — players were reminded to post screenshots.'}`
      )
      .setTimestamp()

    await this.announceToDiscord(bridgeId, embed)

    // Also send an update to the match thread
    if (match.discordThreadId) {
      const client = this.application.discordInstance.getClient()
      const thread = await client.channels.fetch(match.discordThreadId).catch(() => undefined)
      if (thread?.isSendable()) {
        const threadEmbed = new EmbedBuilder()
          .setTitle('🚨 Conflicting Reports Detected')
          .setColor('#FF0000')
          .setDescription(
            'Both players reported different winners. An officer/admin has been notified to resolve the dispute.'
          )
          .setTimestamp()
        await thread.send({ embeds: [threadEmbed] }).catch(() => undefined)
      }
    }
  }

  /**
   * Announce round completion.
   */
  public async announceRoundComplete(tournament: Tournament, round: number): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle(`Round ${round} Complete!`)
      .setColor('#00FF00')
      .setDescription(
        `All matches for Round ${round} of tournament **${tournament.name}** have been completed! Starting next round...`
      )
      .setTimestamp()

    await this.announceToDiscord(tournament.bridgeId, embed)
    await this.announceToGuild(
      tournament.bridgeId,
      `🏆 Round ${round} of tournament ${tournament.name} is complete! Starting next round...`
    )
  }

  /**
   * Announce tournament winner.
   */
  public async announceWinner(tournament: Tournament, winnerName: string): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🏆 Tournament Winner Crowned!')
      .setColor('#FFA500')
      .setDescription(`Congratulations to **${winnerName}** for winning the **${tournament.name}** tournament! 🎉`)
      .setTimestamp()

    await this.announceToDiscord(tournament.bridgeId, embed)
    await this.announceToGuild(
      tournament.bridgeId,
      `🏆 Congratulations to ${winnerName} for winning the ${tournament.name} tournament! 🎉`
    )
  }

  public async announceLiveUpdate(
    tournament: Tournament,
    match: TournamentMatch,
    winnerId: number,
    loserId: number | undefined,
    playerNames: Map<number, string>
  ): Promise<void> {
    if (tournament.liveChannelId === undefined) return
    const winnerName = playerNames.get(winnerId) ?? 'Unknown'
    const loserName = loserId === undefined ? 'BYE' : (playerNames.get(loserId) ?? 'Unknown')
    const score = match.player1Wins > 0 || match.player2Wins > 0 ? `${match.player1Wins}-${match.player2Wins}` : ''

    const embed = new EmbedBuilder()
      .setTitle('🏆 Match Result')
      .setColor('#00FF00')
      .setDescription(
        `**Round ${match.round} — Match ${match.matchIndex + 1}**\n` +
          `**${winnerName}** defeated **${loserName}**${score ? ` ${score}` : ''}\n\n` +
          (match.nextMatchId !== undefined ? 'Advancing to next round!' : '🏆 Tournament champion crowned!')
      )
      .setTimestamp()

    const client = this.application.discordInstance.getClient()
    const channel = await client.channels.fetch(tournament.liveChannelId).catch(() => undefined)
    if (channel?.isSendable()) {
      await channel.send({ embeds: [embed] }).catch(() => undefined)
    }
  }

  public async notifyCancelMinParticipants(
    tournament: Tournament,
    checkedInCount: number,
    minRequired: number
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🏆 Tournament Cancelled — Insufficient Check-ins')
      .setColor('#FF0000')
      .setDescription(
        `Tournament **${tournament.name}** has been cancelled because only ${checkedInCount} player(s) checked in, but ${minRequired} are required.\n\n` +
          `Please try again with more participants next time!`
      )
      .setTimestamp()

    await this.announceToDiscord(tournament.bridgeId, embed)
    await this.announceToGuild(
      tournament.bridgeId,
      `🏆 Tournament ${tournament.name} cancelled: only ${checkedInCount}/${minRequired} checked in.`
    )
  }
}
