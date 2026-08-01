import { EmbedBuilder } from 'discord.js'

import type Application from '../../application.js'
import { MinecraftSendChatPriority } from '../../common/application-event.js'
import { Status } from '../../common/connectable-instance.js'

import type { Tournament, TournamentMatch, TournamentPlayer } from './types.js'

export interface TournamentResultRow {
  id: number
  playerUuid: string
  discordId: string | undefined
  tournamentId: number
  placement: number
  roundsReached: number
  wins: number
  losses: number
  champion: boolean
  createdAt: number
}

export class TournamentNotifications {
  constructor(private readonly application: Application) {}

  /**
   * Translate a key using the bridge-specific translator.
   */
  private t(bridgeId: string, key: string, parameters?: Record<string, any>): string {
    try {
      const translator = this.application.getTranslatorForBridge(bridgeId)
      return translator(key, parameters)
    } catch {
      return key // fallback
    }
  }

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
    this.application.logger.info(
      `sendWhisper: bridgeId=${bridgeId}, playerUuid=${playerUuid}, message="${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`
    )

    const announceMc = this.application.core.bridgeConfigurations.getTournamentAnnounceMc(bridgeId)
    if (!announceMc) {
      this.application.logger.info(`sendWhisper: MC announcements disabled for bridge ${bridgeId}`)
      return false
    }

    // Resolve name from uuid
    const profile = await this.application.mojangApi.profileByUuid(playerUuid).catch(() => {
      this.application.logger.info(`sendWhisper: Failed to resolve profile for ${playerUuid}`)
      return
    })
    if (!profile) return false

    const inst = this.getConnectedMinecraftInstance(bridgeId)
    if (!inst) {
      this.application.logger.info(`sendWhisper: No connected MC instance for bridge ${bridgeId}`)
      return false
    }

    try {
      await inst.send(`/msg ${profile.name} ${message}`, MinecraftSendChatPriority.Default, undefined)
      this.application.logger.info(`sendWhisper: Whisper sent to ${profile.name}`)
      return true
    } catch (error) {
      this.application.logger.info(`sendWhisper: Failed to send whisper to ${profile.name}: ${error}`)
      return false
    }
  }

  /**
   * Sends a public guild chat announcement.
   */
  public async announceToGuild(bridgeId: string, message: string): Promise<void> {
    this.application.logger.info(
      `announceToGuild: bridgeId=${bridgeId}, message="${message.slice(0, 100)}${message.length > 100 ? '...' : ''}"`
    )

    const announceMc = this.application.core.bridgeConfigurations.getTournamentAnnounceMc(bridgeId)
    if (!announceMc) {
      this.application.logger.info(`announceToGuild: MC announcements disabled for bridge ${bridgeId}`)
      return
    }

    const inst = this.getConnectedMinecraftInstance(bridgeId)
    if (!inst) {
      this.application.logger.info(`announceToGuild: No connected MC instance for bridge ${bridgeId}`)
      return
    }

    try {
      await inst.send(`/gc ${message}`, MinecraftSendChatPriority.Default, undefined)
      this.application.logger.info(`announceToGuild: Guild announcement sent`)
    } catch (error) {
      this.application.logger.info(`announceToGuild: Failed: ${error}`)
    }
  }

  /**
   * Sends a Discord announcement embed to the configured tournament notification channel.
   */
  public async announceToDiscord(bridgeId: string, embed: EmbedBuilder): Promise<void> {
    this.application.logger.info(`announceToDiscord: bridgeId=${bridgeId}`)
    const channelId = this.application.core.bridgeConfigurations.getTournamentNotificationChannelId(bridgeId)
    if (!channelId) {
      this.application.logger.info(`announceToDiscord: No notification channel configured for bridge ${bridgeId}`)
      return
    }

    const client = this.application.discordInstance.getClient()
    const channel = await client.channels.fetch(channelId).catch(() => undefined)
    if (channel?.isSendable()) {
      this.application.logger.info(`announceToDiscord: Sending embed to channel ${channelId}`)
      await channel.send({ embeds: [embed] }).catch(() => undefined)
    } else {
      this.application.logger.info(`announceToDiscord: Channel ${channelId} not available for sending`)
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
    this.application.logger.info(
      `Match ${match.id}: Notifying match start — ${p1Name} vs ${p2Name} (round ${match.round})`
    )

    const isTestPlayer = p1Uuid.startsWith('00000000-0000-0000-0000-')
    if (!isTestPlayer) {
      const mcMessage = this.t(bridgeId, 'tournament.match.whisper', {
        round: match.round,
        p1: p1Name,
        p2: p2Name
      })
      await this.sendWhisper(bridgeId, p1Uuid, mcMessage)

      const mcMessage2 = this.t(bridgeId, 'tournament.match.whisper', {
        round: match.round,
        p1: p2Name,
        p2: p1Name
      })
      await this.sendWhisper(bridgeId, p2Uuid, mcMessage2)
    }

    this.application.logger.info(`Match ${match.id}: Notifications sent to both players`)
  }

  /**
   * Sends a "match ready" ping message into the match thread, mentioning both players.
   */
  public async notifyMatchReady(
    threadId: string,
    player1: TournamentPlayer,
    player2: TournamentPlayer,
    p1Name: string,
    p2Name: string
  ): Promise<void> {
    const client = this.application.discordInstance.getClient()
    const thread = await client.channels.fetch(threadId).catch(() => undefined)
    if (!thread?.isSendable()) {
      this.application.logger.info(`notifyMatchReady: Thread ${threadId} not available for sending`)
      return
    }
    const p1Mention = player1.discordId === undefined ? p1Name : `<@${player1.discordId}>`
    const p2Mention = player2.discordId === undefined ? p2Name : `<@${player2.discordId}>`
    this.application.logger.info(`notifyMatchReady: Pinging players in thread ${threadId}`)
    await thread.send({ content: `Your match is ready! ${p1Mention} vs ${p2Mention}` }).catch(() => undefined)
  }

  /**
   * Posts a final standings embed (top-3 medals + placement table) to the bracket and notification channels.
   */
  public async announceResults(tournament: Tournament, results: TournamentResultRow[]): Promise<void> {
    this.application.logger.info(`Tournament ${tournament.id}: Announcing results (${results.length} rows)`)

    const medals = ['🥇', '🥈', '🥉']
    const sorted = [...results].toSorted((a, b) => a.placement - b.placement)
    const lines = sorted.slice(0, 10).map((r) => {
      const medal = r.placement <= 3 ? `${medals[r.placement - 1] ?? ''} ` : `**${r.placement}.** `
      const name = r.discordId === undefined ? `\`${r.playerUuid.slice(0, 8)}\`` : `<@${r.discordId}>`
      return `${medal}${name} — ${r.wins}W ${r.losses}L (${r.roundsReached} round${r.roundsReached === 1 ? '' : 's'})`
    })

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Tournament Results: ${tournament.name}`)
      .setColor('#FFD700')
      .setDescription(lines.join('\n') || 'No results recorded yet.')
      .setTimestamp()

    if (tournament.discordChannelId !== undefined) {
      const client = this.application.discordInstance.getClient()
      const channel = await client.channels.fetch(tournament.discordChannelId).catch(() => undefined)
      if (channel?.isSendable()) {
        await channel.send({ embeds: [embed] }).catch(() => undefined)
      }
    }

    await this.announceToDiscord(tournament.bridgeId, embed)
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
    this.application.logger.info(`Match ${match.id}: Sending deadline warning to ${p1Name} and ${p2Name}`)

    // 1. MC Whispers
    const mcMessage = this.t(bridgeId, 'tournament.deadline.warning', { opponent: p2Name })
    await this.sendWhisper(bridgeId, p1Uuid, mcMessage)

    const mcMessage2 = this.t(bridgeId, 'tournament.deadline.warning', { opponent: p1Name })
    await this.sendWhisper(bridgeId, p2Uuid, mcMessage2)

    // 2. Discord Thread Announcement
    if (match.discordThreadId) {
      this.application.logger.info(`Match ${match.id}: Sending deadline warning to thread ${match.discordThreadId}`)
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
    this.application.logger.info(
      `Match ${match.id}: Notifying dispute — ${p1Name} claims ${r1ClaimedWinner}, ${p2Name} claims ${r2ClaimedWinner}`
    )

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
      this.application.logger.info(`Match ${match.id}: Sending dispute alert to thread ${match.discordThreadId}`)
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
    this.application.logger.info(`Tournament ${tournament.id}: Announcing round ${round} completion`)

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
    this.application.logger.info(`Tournament ${tournament.id}: Announcing winner — ${winnerName}`)

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
    if (tournament.liveChannelId === undefined) {
      this.application.logger.info(`Tournament ${tournament.id}: No live channel for live update`)
      return
    }
    const winnerName = playerNames.get(winnerId) ?? 'Unknown'
    const loserName = loserId === undefined ? 'BYE' : (playerNames.get(loserId) ?? 'Unknown')
    const score = match.player1Wins > 0 || match.player2Wins > 0 ? `${match.player1Wins}-${match.player2Wins}` : ''
    this.application.logger.info(
      `Tournament ${tournament.id}: Live update — ${winnerName} defeated ${loserName}${score ? ` ${score}` : ''}`
    )

    const embed = new EmbedBuilder()
      .setTitle('🏆 Match Result')
      .setColor('#00FF00')
      .setDescription(
        `**Round ${match.round} — Match ${match.matchIndex + 1}**\n` +
          `**${winnerName}** defeated **${loserName}**${score ? ` ${score}` : ''}\n\n` +
          (match.nextMatchId === undefined ? '🏆 Tournament champion crowned!' : 'Advancing to next round!')
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
    this.application.logger.info(
      `Tournament ${tournament.id}: Notifying cancellation — ${checkedInCount}/${minRequired} checked in`
    )
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

  async announceStream(
    bridgeId: string,
    tournamentName: string,
    playerName: string,
    streamUrl: string,
    channelId: string
  ): Promise<void> {
    this.application.logger.info(`announceStream: ${playerName} streaming ${tournamentName} at ${streamUrl}`)
    try {
      const message = `🔴 ${playerName} is now live: ${streamUrl}`

      const embed = new EmbedBuilder()
        .setTitle(`${playerName} is now live!`)
        .setURL(streamUrl)
        .setDescription(`${playerName} is streaming their ${tournamentName} match!`)
        .setColor(0x91_46_ff) // Twitch purple
        .setTimestamp()

      await this.announceToDiscord(bridgeId, embed)

      // Also whisper to all tournament participants
      // (This would need access to tournament players — can be added later)
    } catch (error) {
      this.application.logger.error('Failed to announce stream', error)
    }
  }
}
