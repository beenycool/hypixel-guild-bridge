import type { ButtonInteraction, Client, ModalMessageModalSubmitInteraction, ModalSubmitInteraction } from 'discord.js'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js'

import type { InstanceType } from '../../../common/application-event.js'
import type { DatabaseManager } from '../../../common/database-manager.js'
import SubInstance from '../../../common/sub-instance.js'
import { validateSeriesScore } from '../../../core/tournament/score-validator.js'
import { MatchStatus, TournamentStatus } from '../../../core/tournament/types.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from '../../../core/tournament/types.js'
import type DiscordInstance from '../discord-instance.js'

export const Prefix = 'tournament-btn'

const JoinAction = 'join'
const LeaveAction = 'leave'
const CheckinAction = 'checkin'
const ReportAction = 'report'
const ForfeitAction = 'forfeit'
const ForfeitConfirmAction = 'forfeit-confirm'

interface TournamentButtonCustomId {
  action: string
  tournamentId: number | undefined
  messageId: string | undefined
  matchId: number | undefined
  playerId: number | undefined
}

function parseCustomId(customId: string): TournamentButtonCustomId | undefined {
  const parts = customId.split(':')
  if (parts.length < 2 || parts[0] !== Prefix) return undefined

  const action = parts[1]
  const rest = parts.slice(2)

  let tournamentId: number | undefined = undefined
  let messageId: string | undefined = undefined
  let matchId: number | undefined = undefined
  let playerId: number | undefined = undefined

  switch (action) {
    case ForfeitConfirmAction: {
      matchId = parseNumber(rest[0])
      playerId = parseNumber(rest[1])

      break
    }
    case ReportAction:
    case ForfeitAction: {
      matchId = parseNumber(rest[0])

      break
    }
    case JoinAction:
    case LeaveAction:
    case CheckinAction: {
      tournamentId = parseNumber(rest[0])
      messageId = rest[1]

      break
    }
  }

  return { action, tournamentId, messageId, matchId, playerId }
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

export function buildSignupEmbed(tournament: Tournament, participantCount: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Sign up for ${tournament.name}`)
    .setDescription(
      `Click **Join** below to enter!\n\n` +
        `**Game:** ${tournament.gameType}\n` +
        `**Best of:** ${tournament.bestOf}\n` +
        `**Format:** ${tournament.bracketFormat ?? 'single-elim'}\n` +
        `**Participants:** ${participantCount}`
    )
    .setColor(0x34_98_db)
    .setFooter({ text: `Click the buttons below to join or leave! Tournament ID: ${tournament.id}` })
}

export function buildSignupComponents(tournamentId: number, messageId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${Prefix}:${JoinAction}:${tournamentId}:${messageId}`)
        .setLabel('Join')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`${Prefix}:${LeaveAction}:${tournamentId}:${messageId}`)
        .setLabel('Leave')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    )
  ]
}

export function buildCheckinAnnouncementEmbed(tournament: Tournament): EmbedBuilder {
  let description = `Check-in is now open for **${tournament.name}**!\n\nClick **Check In** below to confirm your participation.`
  if (tournament.checkinClosesAt !== undefined) {
    description += `\n\n**Closes:** <t:${tournament.checkinClosesAt}:F> (<t:${tournament.checkinClosesAt}:R>)`
  }
  return new EmbedBuilder().setTitle('📋 Check-In Open').setColor(0x34_98_db).setDescription(description).setTimestamp()
}

export function buildCheckinComponents(tournamentId: number, messageId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${Prefix}:${CheckinAction}:${tournamentId}:${messageId}`)
        .setLabel('Check In')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
    )
  ]
}

export function buildThreadComponents(matchId: number): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${Prefix}:${ReportAction}:${matchId}`)
        .setLabel('Report Result')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝'),
      new ButtonBuilder()
        .setCustomId(`${Prefix}:${ForfeitAction}:${matchId}`)
        .setLabel('Forfeit')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🏳️')
    )
  ]
}

function buildReportModal(matchId: number): ModalBuilder {
  return (
    new ModalBuilder()
      .setCustomId(`${Prefix}:${ReportAction}:${matchId}`)
      .setTitle('Report Match Result')
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('my-wins')
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            .setLabel('Your wins')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2)
            .setPlaceholder('Games you won')
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('their-wins')
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            .setLabel('Opponent wins')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2)
            .setPlaceholder('Games your opponent won')
        )
      )
  )
}

function deriveWinner(
  myWins: number,
  theirWins: number,
  reporterPlayerId: number,
  opponentPlayerId: number
): number | undefined {
  if (myWins > theirWins) return reporterPlayerId
  if (theirWins > myWins) return opponentPlayerId
  return undefined
}

export async function fetchParticipantCount(database: DatabaseManager, tournamentId: number): Promise<number> {
  const row = await database.queryOne<{ count: string }>(
    'SELECT COUNT(*)::TEXT AS "count" FROM "tournament_players" WHERE "tournamentId" = $1',
    [tournamentId]
  )
  return Number(row?.count ?? 0)
}

export default class TournamentButtons extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  constructor(clientInstance: DiscordInstance) {
    super(clientInstance)

    this.application.logger.info('TournamentButtons: Initialized')

    const client = this.clientInstance.getClient()
    client.on('interactionCreate', (interaction) => {
      if (!interaction.isButton() && !interaction.isModalSubmit()) return
      if (!interaction.customId.startsWith(`${Prefix}:`)) return

      void this.handleInteraction(interaction).catch(
        this.errorHandler.promiseCatch('handling tournament button interaction')
      )
    })
  }

  private async handleInteraction(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId)
    if (parsed === undefined) {
      this.application.logger.info(`TournamentButtons: Invalid customId: ${interaction.customId}`)
      await interaction.reply({ content: 'Invalid button.', flags: MessageFlags.Ephemeral })
      return
    }

    this.application.logger.info(
      `TournamentButtons: Interaction — action=${parsed.action}, user=${interaction.user.id}, customId=${interaction.customId}`
    )

    switch (parsed.action) {
      case JoinAction: {
        if (!interaction.isButton()) break
        if (parsed.tournamentId === undefined || parsed.messageId === undefined) {
          await this.replyInvalidButton(interaction)
          break
        }
        await this.handleJoin(interaction, parsed.tournamentId, parsed.messageId)
        break
      }
      case LeaveAction: {
        if (!interaction.isButton()) break
        if (parsed.tournamentId === undefined || parsed.messageId === undefined) {
          await this.replyInvalidButton(interaction)
          break
        }
        await this.handleLeave(interaction, parsed.tournamentId, parsed.messageId)
        break
      }
      case CheckinAction: {
        if (!interaction.isButton()) break
        if (parsed.tournamentId === undefined || parsed.messageId === undefined) {
          await this.replyInvalidButton(interaction)
          break
        }
        await this.handleCheckin(interaction, parsed.tournamentId)
        break
      }
      case ReportAction: {
        if (interaction.isButton()) {
          await (parsed.matchId === undefined
            ? this.replyInvalidButton(interaction)
            : this.handleReportButton(interaction, parsed.matchId))
        } else if (interaction.isModalSubmit() && interaction.isFromMessage()) {
          await (parsed.matchId === undefined
            ? this.replyInvalidButton(interaction)
            : this.handleReportSubmit(interaction, parsed.matchId))
        }
        break
      }
      case ForfeitAction: {
        if (!interaction.isButton()) break
        if (parsed.matchId === undefined) {
          await this.replyInvalidButton(interaction)
          break
        }
        await this.handleForfeit(interaction, parsed.matchId)
        break
      }
      case ForfeitConfirmAction: {
        if (!interaction.isButton()) break
        if (parsed.matchId === undefined || parsed.playerId === undefined) {
          await this.replyInvalidButton(interaction)
          break
        }
        await this.handleForfeitConfirm(interaction, parsed.matchId, parsed.playerId)
        break
      }
      default: {
        await interaction.reply({ content: `Unknown action: ${parsed.action}`, flags: MessageFlags.Ephemeral })
      }
    }
  }

  private async replyInvalidButton(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
    this.application.logger.info(`TournamentButtons: Invalid button customId: ${interaction.customId}`)
    await interaction.reply({ content: 'Invalid button.', flags: MessageFlags.Ephemeral })
  }

  private async handleJoin(interaction: ButtonInteraction, tournamentId: number, messageId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const tournament = await this.application.core.tournamentManager.getTournament(tournamentId)
    if (tournament === undefined || tournament.status !== TournamentStatus.Signup) {
      this.application.logger.info(`TournamentButtons: Join rejected — tournament ${tournamentId} not in signup`)
      await interaction.editReply('Signups are closed for this tournament.')
      return
    }

    const link = await this.application.core.verification.findByDiscord(interaction.user.id)
    if (link === undefined) {
      await interaction.editReply('You must link your Minecraft account first! Use `/verify` or contact an officer.')
      return
    }

    this.application.logger.info(`TournamentButtons: Join — tournament=${tournamentId}, user=${interaction.user.id}`)
    try {
      await this.application.core.tournamentManager.addPlayer(tournamentId, link.uuid, interaction.user.id)

      const profile = await this.application.mojangApi.profileByUuid(link.uuid).catch(() => undefined)
      const name = profile?.name ?? link.uuid
      await interaction.editReply(`✅ You have successfully joined the tournament as **${name}**!`)

      await this.refreshSignupMessage(tournament, messageId)
    } catch (error: unknown) {
      await interaction.editReply(error instanceof Error ? error.message : String(error))
    }
  }

  private async handleLeave(interaction: ButtonInteraction, tournamentId: number, messageId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const tournament = await this.application.core.tournamentManager.getTournament(tournamentId)
    if (tournament === undefined || tournament.status !== TournamentStatus.Signup) {
      this.application.logger.info(`TournamentButtons: Leave rejected — tournament ${tournamentId} not in signup`)
      await interaction.editReply('You can only leave during the signup phase.')
      return
    }

    const link = await this.application.core.verification.findByDiscord(interaction.user.id)
    if (link === undefined) {
      await interaction.editReply('You are not registered in this tournament.')
      return
    }

    this.application.logger.info(`TournamentButtons: Leave — tournament=${tournamentId}, user=${interaction.user.id}`)
    try {
      await this.application.core.tournamentManager.removePlayer(tournamentId, link.uuid)
      await interaction.editReply('✅ You have left the tournament.')

      await this.refreshSignupMessage(tournament, messageId)
    } catch (error: unknown) {
      await interaction.editReply(error instanceof Error ? error.message : String(error))
    }
  }

  private async handleCheckin(interaction: ButtonInteraction, tournamentId: number): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const tournament = await this.application.core.tournamentManager.getTournament(tournamentId)
    if (tournament === undefined || tournament.status !== TournamentStatus.Signup) {
      await interaction.editReply('There is no tournament in the signup phase.')
      return
    }

    const now = Math.floor(Date.now() / 1000)
    if (tournament.checkinOpensAt !== undefined && now < tournament.checkinOpensAt) {
      await interaction.editReply('Check-in has not opened yet.')
      return
    }
    if (tournament.checkinClosesAt !== undefined && now >= tournament.checkinClosesAt) {
      await interaction.editReply('Check-in window has closed.')
      return
    }

    const link = await this.application.core.verification.findByDiscord(interaction.user.id)
    if (link === undefined) {
      await interaction.editReply('You must link your Minecraft account first! Use `/verify` or contact an officer.')
      return
    }

    this.application.logger.info(
      `TournamentButtons: Check-in — tournament=${tournamentId}, user=${interaction.user.id}`
    )
    try {
      await this.application.core.tournamentManager.checkinPlayer(tournamentId, link.uuid, interaction.user.id)
      await interaction.editReply('✅ You have checked in for the tournament!')
    } catch (error: unknown) {
      await interaction.editReply(error instanceof Error ? error.message : String(error))
    }
  }

  private async handleReportButton(interaction: ButtonInteraction, matchId: number): Promise<void> {
    const match = await this.loadMatch(matchId)
    if (match === undefined) {
      this.application.logger.info(`TournamentButtons: Report modal rejected — match ${matchId} not found`)
      await interaction.reply({ content: 'Match not found.', flags: MessageFlags.Ephemeral })
      return
    }
    if (match.status !== MatchStatus.Active && match.status !== MatchStatus.Reported) {
      this.application.logger.info(`TournamentButtons: Report modal rejected — match ${matchId} status ${match.status}`)
      await interaction.reply({ content: 'This match can no longer be reported.', flags: MessageFlags.Ephemeral })
      return
    }

    const reporter = await this.findMatchPlayer(match, interaction.user.id)
    if (reporter === undefined) {
      await interaction.reply({ content: 'You are not a participant in this match.', flags: MessageFlags.Ephemeral })
      return
    }

    this.application.logger.info(
      `TournamentButtons: Report modal opened — match=${matchId}, user=${interaction.user.id}`
    )
    await interaction.showModal(buildReportModal(matchId))
  }

  private async handleReportSubmit(interaction: ModalMessageModalSubmitInteraction, matchId: number): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const match = await this.loadMatch(matchId)
    if (match === undefined) {
      await interaction.editReply('Match not found.')
      return
    }
    if (match.status !== MatchStatus.Active && match.status !== MatchStatus.Reported) {
      await interaction.editReply('This match can no longer be reported.')
      return
    }

    const reporter = await this.findMatchPlayer(match, interaction.user.id)
    if (reporter === undefined) {
      await interaction.editReply('You are not a participant in this match.')
      return
    }

    const myWinsRaw = interaction.fields.getTextInputValue('my-wins').trim()
    const theirWinsRaw = interaction.fields.getTextInputValue('their-wins').trim()
    const myWins = Number.parseInt(myWinsRaw, 10)
    const theirWins = Number.parseInt(theirWinsRaw, 10)
    if (
      myWinsRaw === '' ||
      theirWinsRaw === '' ||
      !Number.isInteger(myWins) ||
      !Number.isInteger(theirWins) ||
      myWins < 0 ||
      theirWins < 0 ||
      myWinsRaw !== String(myWins) ||
      theirWinsRaw !== String(theirWins)
    ) {
      await interaction.editReply('Scores must be non-negative whole numbers.')
      return
    }

    const opponentId = match.player1Id === reporter.id ? match.player2Id : match.player1Id
    if (opponentId === undefined) {
      await interaction.editReply('This match is missing an opponent.')
      return
    }

    const tournament = await this.application.core.tournamentManager.getTournament(match.tournamentId)
    if (tournament === undefined) {
      await interaction.editReply('Tournament no longer exists.')
      return
    }

    const isPlayer1 = match.player1Id === reporter.id
    const p1Wins = isPlayer1 ? myWins : theirWins
    const p2Wins = isPlayer1 ? theirWins : myWins

    const validation = validateSeriesScore(tournament.bestOf, p1Wins, p2Wins)
    if (!validation.valid) {
      await interaction.editReply(validation.message)
      return
    }

    const claimedWinnerId = deriveWinner(myWins, theirWins, reporter.id, opponentId)
    if (claimedWinnerId === undefined) {
      await interaction.editReply('Scores cannot end in a tie.')
      return
    }

    this.application.logger.info(
      `TournamentButtons: Report submit — match=${matchId}, player=${reporter.id}, myWins=${myWins}, theirWins=${theirWins}`
    )
    try {
      const result = await this.application.core.tournamentManager.matchManager.submitReport(
        matchId,
        reporter.id,
        claimedWinnerId,
        p1Wins,
        p2Wins
      )
      let replyMessage = result.message
      if (match.discordThreadId !== undefined && result.status !== MatchStatus.Completed) {
        const hasProof = await this.application.core.tournamentManager.channelManager
          .checkProofAttachment(match.discordThreadId)
          .catch(() => false)
        if (!hasProof) {
          replyMessage +=
            '\n\n⚠️ **Reminder:** Please post a screenshot of the scoreboard in this thread for dispute purposes.'
        }
      }
      await interaction.editReply(replyMessage)
    } catch (error: unknown) {
      await interaction.editReply(error instanceof Error ? error.message : String(error))
    }
  }

  private async handleForfeit(interaction: ButtonInteraction, matchId: number): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const match = await this.loadMatch(matchId)
    if (match === undefined) {
      this.application.logger.info(`TournamentButtons: Forfeit rejected — match ${matchId} not found`)
      await interaction.editReply('Match not found.')
      return
    }
    if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
      await interaction.editReply('This match is already completed.')
      return
    }

    const player = await this.findMatchPlayer(match, interaction.user.id)
    if (player === undefined) {
      await interaction.editReply('You are not a participant in this match.')
      return
    }

    this.application.logger.info(
      `TournamentButtons: Forfeit requested — match=${matchId}, player=${player.id}, user=${interaction.user.id}`
    )
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${Prefix}:${ForfeitConfirmAction}:${matchId}:${player.id}`)
        .setLabel('Confirm Forfeit')
        .setStyle(ButtonStyle.Danger)
    )
    await interaction.editReply({ content: 'Forfeit this match?', components: [confirmRow] })
  }

  private async handleForfeitConfirm(interaction: ButtonInteraction, matchId: number, playerId: number): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const match = await this.loadMatch(matchId)
    if (match === undefined) {
      await interaction.editReply('Match not found.')
      return
    }
    if (match.status === MatchStatus.Completed || match.status === MatchStatus.Bye) {
      await interaction.editReply('This match is already completed.')
      return
    }
    if (match.player1Id !== playerId && match.player2Id !== playerId) {
      await interaction.editReply('You are not a participant in this match.')
      return
    }

    const player = await this.application.core.databaseManager.queryOne<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "id" = $1',
      [playerId]
    )
    if (player === undefined || player.discordId !== interaction.user.id) {
      await interaction.editReply('You are not a participant in this match.')
      return
    }

    this.application.logger.info(`TournamentButtons: Forfeit confirmed — match=${matchId}, player=${playerId}`)
    try {
      const result = await this.application.core.tournamentManager.matchManager.forfeit(matchId, playerId)
      await interaction.editReply(result.message)
    } catch (error: unknown) {
      await interaction.editReply(error instanceof Error ? error.message : String(error))
    }
  }

  private async loadMatch(matchId: number): Promise<TournamentMatch | undefined> {
    return await this.application.core.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "id" = $1',
      [matchId]
    )
  }

  private async findMatchPlayer(match: TournamentMatch, discordId: string): Promise<TournamentPlayer | undefined> {
    const p1 =
      match.player1Id === undefined
        ? undefined
        : await this.application.core.databaseManager.queryOne<TournamentPlayer>(
            'SELECT * FROM "tournament_players" WHERE "id" = $1',
            [match.player1Id]
          )
    const p2 =
      match.player2Id === undefined
        ? undefined
        : await this.application.core.databaseManager.queryOne<TournamentPlayer>(
            'SELECT * FROM "tournament_players" WHERE "id" = $1',
            [match.player2Id]
          )
    if (p1?.discordId === discordId) return p1
    if (p2?.discordId === discordId) return p2
    return undefined
  }

  private async refreshSignupMessage(tournament: Tournament, messageId: string): Promise<void> {
    const channelId = this.application.core.bridgeConfigurations.getTournamentNotificationChannelId(tournament.bridgeId)
    if (!channelId) return

    const channel = await this.clientInstance
      .getClient()
      .channels.fetch(channelId)
      .catch(() => undefined)
    if (!channel?.isTextBased()) return

    const message = await channel.messages.fetch(messageId).catch(() => undefined)
    if (message === undefined) return

    const participantCount = await fetchParticipantCount(this.application.core.databaseManager, tournament.id)
    await message
      .edit({
        embeds: [buildSignupEmbed(tournament, participantCount)],
        components: buildSignupComponents(tournament.id, messageId)
      })
      .catch(() => undefined)
  }
}
