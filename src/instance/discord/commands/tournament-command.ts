import * as chrono from 'chrono-node'
import { MessageFlags, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands.js'
import { validateSeriesScore } from '../../../core/tournament/score-validator.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from '../../../core/tournament/types.js'
import type { TournamentMatch, TournamentPlayer } from '../../../core/tournament/types.js'

/**
 * Notifies staff (officer/helper/owner roles) when a user cannot be resolved
 * from Minecraft to Discord and needs manual help with verification.
 * Falls back to the tournament notification channel, then the command channel.
 */
async function notifyStaffForUnlinkedUser(
  context: Readonly<DiscordCommandContext>,
  bridgeId: string,
  description: string
): Promise<void> {
  try {
    const { bridgeConfigurations, discordConfigurations } = context.application.core
    const roleIds = [
      ...bridgeConfigurations.getOfficerRoleIds(bridgeId),
      ...bridgeConfigurations.getHelperRoleIds(bridgeId),
      ...bridgeConfigurations.getOwnerRoleIds(bridgeId),
      ...discordConfigurations.getOfficerRoleIds(),
      ...discordConfigurations.getHelperRoleIds(),
      ...discordConfigurations.getOwnerRoleIds()
    ]
    const uniqueRoleIds = [...new Set(roleIds.filter((id) => id.length > 0))]

    const notificationChannelId = bridgeConfigurations.getTournamentNotificationChannelId(bridgeId)
    const client = context.application.discordInstance.getClient()
    const notificationChannel = notificationChannelId
      ? await client.channels.fetch(notificationChannelId).catch(() => undefined)
      : undefined
    const target = notificationChannel?.isSendable()
      ? notificationChannel
      : context.interaction.channel?.isSendable()
        ? context.interaction.channel
        : undefined

    if (target === undefined) {
      context.application.logger.warn(
        `Cannot notify staff for unlinked user: no sendable channel available (bridgeId=${bridgeId})`
      )
      return
    }

    const pingContent = uniqueRoleIds.map((id) => `<@&${id}>`).join(' ')
    await target.send({
      content: `${pingContent.length > 0 ? `${pingContent} ` : ''}${description}`,
      allowedMentions: { parse: [], roles: uniqueRoleIds }
    })
    context.application.logger.info(`Notified staff about unlinked user (bridgeId=${bridgeId})`)
  } catch (error: unknown) {
    context.application.logger.warn('Failed to notify staff about unlinked user', error)
  }
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('tournament')
      .setDescription(
        'Player commands for guild tournaments — admin actions are managed in the web dashboard (/dashboard)'
      )
      .addSubcommand((sub) => sub.setName('join').setDescription('Join the tournament'))
      .addSubcommand((sub) => sub.setName('leave').setDescription('Leave the tournament'))
      .addSubcommand((sub) => sub.setName('checkin').setDescription('Check in for the tournament'))
      .addSubcommand((sub) =>
        sub
          .setName('report')
          .setDescription('Report your match results')
          .addStringOption((opt) =>
            opt
              .setName('winner')
              .setDescription('Who won the series?')
              .setRequired(true)
              .addChoices({ name: 'Me', value: 'me' }, { name: 'Opponent', value: 'opponent' })
          )
          .addIntegerOption((opt) => opt.setName('my_wins').setDescription('Your score/wins').setRequired(true))
          .addIntegerOption((opt) => opt.setName('their_wins').setDescription('Opponent score/wins').setRequired(true))
      )
      .addSubcommand((sub) => sub.setName('forfeit').setDescription('Forfeit your current match'))
      .addSubcommand((sub) =>
        sub
          .setName('schedule')
          .setDescription('Set your availability for upcoming matches')
          .addStringOption((opt) =>
            opt.setName('time').setDescription('Time range (e.g., "Saturday 14:00-18:00 GMT")').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('proof')
          .setDescription('Add a proof/replay URL to your match')
          .addStringOption((opt) =>
            opt.setName('url').setDescription('URL to proof (YouTube, Imgur, Twitch VOD, etc.)').setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt.setName('match_id').setDescription('Match ID (optional if inside match thread)').setRequired(false)
          )
      ),

  permission: Permission.Anyone, // Player-facing commands; admin actions moved to the web dashboard

  handler: async function (context) {
    const subcommand = context.interaction.options.getSubcommand()
    context.application.logger.info(
      `Discord /tournament ${subcommand} — user=${context.interaction.user.id}, channel=${context.interaction.channelId}`
    )
    let bridgeId = context.bridgeId

    // Allow tournament commands from any Discord channel: infer the bridge
    // from the guild when it maps to exactly one bridge.
    if (bridgeId === undefined) {
      if (context.application.bridgeResolver.isMultiBridgeEnabled()) {
        const guild =
          context.interaction.guild ??
          (context.interaction.guildId === null
            ? undefined
            : await context.interaction.client.guilds.fetch(context.interaction.guildId).catch(() => undefined))
        if (guild !== undefined) {
          const guildBridgeIds = new Set<string>()
          for (const [, channel] of guild.channels.cache) {
            const bid = context.application.bridgeResolver.getBridgeIdForChannel(channel.id)
            if (bid !== undefined) guildBridgeIds.add(bid)
          }
          if (guildBridgeIds.size === 1) {
            bridgeId = [...guildBridgeIds][0]
            context.application.logger.info(
              `Discord /tournament ${subcommand}: resolved bridgeId=${bridgeId} from guild=${guild.id}`
            )
          }
        }
      } else {
        bridgeId = 'default'
      }
    }

    if (bridgeId === undefined) {
      await context.interaction.reply({
        content: 'This command can only be executed within a bridge channel.',
        ephemeral: true
      })
      return
    }

    const tournamentEnabled = context.application.core.bridgeConfigurations.getTournamentEnabled(bridgeId)
    if (!tournamentEnabled) {
      await context.interaction.reply({
        content: 'Tournaments are not enabled on this bridge.',
        ephemeral: true
      })
      return
    }

    // 1. Join Tournament
    if (subcommand === 'join') {
      await context.interaction.deferReply()

      // Fetch active tournament
      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Signup) {
        await context.interaction.editReply('There is no active signup phase for this bridge.')
        return
      }

      // Check verification link
      const link = await context.application.core.verification.findByDiscord(context.interaction.user.id)
      if (link === undefined) {
        await context.interaction.editReply(
          'You must link your Minecraft account first. Staff have been notified to help you verify.'
        )
        await notifyStaffForUnlinkedUser(
          context,
          bridgeId,
          `<@${context.interaction.user.id}> tried to join the tournament, but their Minecraft account could not be resolved to a Discord link. Please help them get verified.`
        )
        return
      }

      context.application.logger.info(
        `Discord /tournament join: tournament=${tournament.id}, user=${context.interaction.user.id}`
      )
      try {
        await context.application.core.tournamentManager.addPlayer(
          tournament.id,
          link.uuid,
          context.interaction.user.id
        )

        // Resolve MC Name
        const profile = await context.application.mojangApi.profileByUuid(link.uuid)
        await context.interaction.editReply(`✅ You have successfully joined the tournament as **${profile.name}**!`)
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 2. Leave Tournament
    if (subcommand === 'leave') {
      await context.interaction.deferReply()

      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Signup) {
        await context.interaction.editReply('You can only leave during the signup phase.')
        return
      }

      const link = await context.application.core.verification.findByDiscord(context.interaction.user.id)
      if (link === undefined) {
        await context.interaction.editReply('You are not registered in this tournament.')
        return
      }

      context.application.logger.info(
        `Discord /tournament leave: tournament=${tournament.id}, user=${context.interaction.user.id}`
      )
      try {
        await context.application.core.tournamentManager.removePlayer(tournament.id, link.uuid)
        await context.interaction.editReply('✅ You have left the tournament.')
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 3. Check-in
    if (subcommand === 'checkin') {
      await context.interaction.deferReply()

      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Signup) {
        await context.interaction.editReply('There is no tournament in the signup phase.')
        return
      }

      const link = await context.application.core.verification.findByDiscord(context.interaction.user.id)
      if (link === undefined) {
        await context.interaction.editReply(
          'You must link your Minecraft account first. Staff have been notified to help you verify.'
        )
        await notifyStaffForUnlinkedUser(
          context,
          bridgeId,
          `<@${context.interaction.user.id}> tried to check in for the tournament, but their Minecraft account could not be resolved to a Discord link. Please help them get verified.`
        )
        return
      }

      context.application.logger.info(
        `Discord /tournament checkin: tournament=${tournament.id}, user=${context.interaction.user.id}`
      )
      try {
        await context.application.core.tournamentManager.checkinPlayer(
          tournament.id,
          link.uuid,
          context.interaction.user.id
        )
        await context.interaction.editReply('✅ You have checked in for the tournament!')
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 4. Report Results
    if (subcommand === 'report') {
      await context.interaction.deferReply()
      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
        await context.interaction.editReply('There is no active tournament currently.')
        return
      }

      const link = await context.application.core.verification.findByDiscord(context.interaction.user.id)
      if (link === undefined) {
        await context.interaction.editReply('You must be verified and registered to report.')
        return
      }

      // Find the player in tournament_players
      const player = await context.application.core.databaseManager.queryOne<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
        [tournament.id, link.uuid]
      )
      if (player === undefined || player.status === PlayerStatus.Eliminated) {
        await context.interaction.editReply('You are not active in this tournament.')
        return
      }

      // Find active match for this player
      const match = await context.application.core.databaseManager.queryOne<TournamentMatch>(
        `SELECT * FROM "tournament_matches"
         WHERE "tournamentId" = $1
           AND ("player1Id" = $2 OR "player2Id" = $2)
           AND "status" IN ($3, $4, $5)`,
        [tournament.id, player.id, MatchStatus.Active, MatchStatus.Reported, MatchStatus.Disputed]
      )

      if (match === undefined) {
        await context.interaction.editReply('You do not have an active match to report.')
        return
      }

      const winnerChoice = context.interaction.options.getString('winner', true)
      const myWins = context.interaction.options.getInteger('my_wins', true)
      const theirWins = context.interaction.options.getInteger('their_wins', true)

      const validation = validateSeriesScore(tournament.bestOf, myWins, theirWins)
      if (!validation.valid) {
        await context.interaction.editReply(validation.message)
        return
      }

      // Determine who the reported winner is
      let claimedWinnerId = player.id
      if (winnerChoice === 'opponent') {
        claimedWinnerId = (match.player1Id === player.id ? match.player2Id : match.player1Id) ?? player.id
      }

      // Assign wins based on who's who
      const isPlayer1 = match.player1Id === player.id
      const p1Wins = isPlayer1 ? myWins : theirWins
      const p2Wins = isPlayer1 ? theirWins : myWins

      context.application.logger.info(
        `Discord /tournament report: match=${match.id}, player=${player.id}, winnerChoice=${winnerChoice}, myWins=${myWins}, theirWins=${theirWins}`
      )
      try {
        const result = await context.application.core.tournamentManager.matchManager.submitReport(
          match.id,
          player.id,
          claimedWinnerId,
          p1Wins,
          p2Wins
        )
        let replyMessage = result.message
        if (match.discordThreadId !== undefined && result.status !== MatchStatus.Completed) {
          const hasProof = await context.application.core.tournamentManager.channelManager.checkProofAttachment(
            match.discordThreadId
          )
          if (!hasProof) {
            replyMessage +=
              '\n\n⚠️ **Reminder:** Please post a screenshot of the scoreboard in this thread for dispute purposes.'
          }
        }
        await context.interaction.editReply(replyMessage)
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 5. Forfeit
    if (subcommand === 'forfeit') {
      await context.interaction.deferReply()

      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
        await context.interaction.editReply('There is no active tournament currently.')
        return
      }

      const link = await context.application.core.verification.findByDiscord(context.interaction.user.id)
      if (link === undefined) {
        await context.interaction.editReply('You must be verified to forfeit.')
        return
      }

      const player = await context.application.core.databaseManager.queryOne<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
        [tournament.id, link.uuid]
      )
      if (player === undefined || player.status === PlayerStatus.Eliminated) {
        await context.interaction.editReply('You are not active in this tournament.')
        return
      }

      const match = await context.application.core.databaseManager.queryOne<TournamentMatch>(
        `SELECT * FROM "tournament_matches"
         WHERE "tournamentId" = $1
           AND ("player1Id" = $2 OR "player2Id" = $2)
           AND "status" = $3`,
        [tournament.id, player.id, MatchStatus.Active]
      )

      if (match === undefined) {
        await context.interaction.editReply('You do not have an active match to forfeit.')
        return
      }

      context.application.logger.info(`Discord /tournament forfeit: match=${match.id}, player=${player.id}`)
      try {
        await context.application.core.tournamentManager.matchManager.forfeit(match.id, player.id)
        await context.interaction.editReply('Forfeit accepted.')
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 6. Schedule Availability
    if (subcommand === 'schedule') {
      const timeString = context.interaction.options.getString('time', true)
      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (!tournament || tournament.status !== TournamentStatus.Active) {
        await context.interaction.reply({
          content: 'No active tournament on this bridge.',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      const link = await context.application.core.verification.findByDiscord(context.interaction.user.id)
      if (link === undefined) {
        await context.interaction.reply({
          content: 'You must be verified and registered to schedule.',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      const player = await context.application.core.databaseManager.queryOne<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1 AND "playerUuid" = $2',
        [tournament.id, link.uuid]
      )
      if (player === undefined || player.status === PlayerStatus.Eliminated) {
        await context.interaction.reply({
          content: 'You are not active in this tournament.',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      const match = await context.application.core.databaseManager.queryOne<TournamentMatch>(
        `SELECT * FROM "tournament_matches"
         WHERE "tournamentId" = $1
           AND ("player1Id" = $2 OR "player2Id" = $2)
           AND "status" IN ($3, $4)`,
        [tournament.id, player.id, MatchStatus.Active, MatchStatus.Reported]
      )

      try {
        const parsed = chrono.parse(timeString)
        if (parsed.length === 0) {
          await context.interaction.reply({
            content: 'Could not parse that time. Try: "Saturday 14:00-18:00 GMT"',
            flags: MessageFlags.Ephemeral
          })
          return
        }

        const startDate = parsed[0].start?.date()
        const endDate = parsed[0].end?.date()

        let response = `**Your availability has been recorded for:**\n`
        if (startDate) response += `<t:${Math.floor(startDate.getTime() / 1000)}:F>\n`
        if (endDate) response += `to <t:${Math.floor(endDate.getTime() / 1000)}:F>`

        // Post availability to match thread for opponent visibility
        if (match?.discordThreadId !== undefined) {
          try {
            const thread = await context.application.discordInstance.getClient().channels.fetch(match.discordThreadId)
            if (thread !== null && 'send' in thread) {
              const names = await context.application.core.tournamentManager.getPlayerNames(tournament.id)
              const pName = names.get(player.id) ?? 'A player'
              await thread.send({
                content: `📅 **${pName}** is available:\n${response}`
              })
            }
          } catch {
            // Thread may not exist - still send user reply
          }
        }

        await context.interaction.reply({ content: response, flags: MessageFlags.Ephemeral })
      } catch {
        await context.interaction.reply({
          content: 'Could not parse that time. Try a simpler format.',
          flags: MessageFlags.Ephemeral
        })
      }
      return
    }

    // 7. Proof Attachment
    if (subcommand === 'proof') {
      let matchId = context.interaction.options.getInteger('match_id')
      const url = context.interaction.options.getString('url', true)

      if (matchId === null) {
        const matchByChannel = await context.application.core.databaseManager.queryOne<TournamentMatch>(
          'SELECT * FROM "tournament_matches" WHERE "discordThreadId" = $1',
          [context.interaction.channelId]
        )
        if (matchByChannel === undefined) {
          await context.interaction.reply({
            content: 'Could not auto-detect match ID in this channel. Please specify `match_id`.',
            flags: MessageFlags.Ephemeral
          })
          return
        }
        matchId = matchByChannel.id
      }

      context.application.logger.info(`Discord /tournament proof: matchId=${matchId}, url="${url}"`)
      try {
        new URL(url)
      } catch {
        await context.interaction.reply({ content: 'Invalid URL format.', flags: MessageFlags.Ephemeral })
        return
      }

      try {
        await context.application.core.databaseManager.execute(
          `UPDATE "tournament_matches" SET "hadProofAttachment" = TRUE WHERE "id" = $1`,
          [matchId]
        )
        await context.interaction.reply({
          content: `✅ Proof URL recorded for match #${matchId}: ${url}`,
          flags: MessageFlags.Ephemeral
        })
      } catch (error) {
        await context.interaction.reply({ content: `Error recording proof: ${error}`, flags: MessageFlags.Ephemeral })
      }
      return
    }
  }
} satisfies DiscordCommandHandler
