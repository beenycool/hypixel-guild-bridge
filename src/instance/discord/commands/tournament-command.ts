import { randomInt } from 'node:crypto'

import * as chrono from 'chrono-node'
import { ChannelType, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { validateSeriesScore } from '../../../core/tournament/score-validator.js'
import { MatchStatus, PlayerStatus, TournamentStatus } from '../../../core/tournament/types.js'
import type { TournamentMatch, TournamentPlayer } from '../../../core/tournament/types.js'

const TestChatMessages = [
  'gg everyone lets play soon',
  'what time works for you? im free after 5pm est',
  'bridge or bedwars?',
  'ill take the first game, you host',
  'ready when you are',
  'wanna go best of 3? i think thats default',
  'good game, well played',
  'rematch next round maybe',
  'im down for bridge',
  'anyone wanna warm up first?',
  'what server are we playing on?',
  'lets goooo',
  'that was close last game',
  'gl hf everyone',
  'im in the tournament chat on disc',
  'can someone invite me to the party?',
  'what seed are you?',
  'gg wp',
  'see you next round',
  'brb getting water',
  'ok im back ready to play',
  'lets go round 2',
  'that was a good match',
  'who won the other match?',
  'bracket looks crazy',
  'cant wait for finals',
  'this tournament is fun',
  'thanks for organizing this',
  'everyone ready? lets start'
]

const SchedulingOptions = [
  'Saturday 14:00-18:00 GMT',
  'Sunday afternoon EST',
  'tomorrow after 5pm',
  'Saturday morning CET',
  'weekdays after 6pm UTC',
  'Sunday 10:00-14:00 GMT',
  'this weekend anytime',
  'Friday evening EST'
]

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('tournament')
      .setDescription('Manage or participate in single-elimination guild tournaments')
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Create a new tournament (Admin/Officer only)')
          .addStringOption((opt) => opt.setName('name').setDescription('Name of the tournament').setRequired(true))
          .addStringOption((opt) =>
            opt.setName('game_type').setDescription('Hypixel duel type (e.g., BedWars Duels)').setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt.setName('best_of').setDescription('Best of X series (odd numbers)').setRequired(false)
          )
          .addIntegerOption((opt) =>
            opt.setName('deadline_hours').setDescription('Hours allowed per round').setRequired(false)
          )
      )
      .addSubcommand((sub) => sub.setName('join').setDescription('Join the tournament'))
      .addSubcommand((sub) => sub.setName('leave').setDescription('Leave the tournament'))
      .addSubcommand((sub) => sub.setName('start').setDescription('Start the tournament bracket (Admin/Officer only)'))
      .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel the active tournament (Admin/Officer only)'))
      .addSubcommand((sub) => sub.setName('status').setDescription('Show current tournament status'))
      .addSubcommand((sub) => sub.setName('bracket').setDescription('View the live tournament bracket channel'))
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
      .addSubcommand((sub) =>
        sub
          .setName('confirm')
          .setDescription('Resolve a disputed match (Admin/Officer only)')
          .addIntegerOption((opt) =>
            opt.setName('match_id').setDescription('Disputed match ID').setRequired(true).setAutocomplete(true)
          )
          .addStringOption((opt) =>
            opt.setName('winner').setDescription('Forced winner username').setRequired(true).setAutocomplete(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName('open-checkin').setDescription('Manually open check-in for the tournament (Admin/Officer only)')
      )
      .addSubcommand((sub) => sub.setName('checkin').setDescription('Check in for the tournament'))
      .addSubcommand((sub) =>
        sub
          .setName('extend')
          .setDescription('Extend a match deadline (Admin/Officer only)')
          .addIntegerOption((opt) => opt.setName('match_id').setDescription('Match ID to extend').setRequired(true))
          .addIntegerOption((opt) =>
            opt.setName('hours').setDescription('Hours to extend the deadline by').setRequired(true)
          )
      )
      .addSubcommand((sub) => sub.setName('forfeit').setDescription('Forfeit your current match'))
      .addSubcommand((sub) =>
        sub
          .setName('set-category')
          .setDescription('Set the Discord category for all tournament channels (Admin only)')
          .addChannelOption((opt) =>
            opt
              .setName('category')
              .setDescription('Discord category for tournament channels')
              .addChannelTypes(ChannelType.GuildCategory)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('test')
          .setDescription('Create an interactive test tournament with fake players (Admin/Officer only)')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Name of the test tournament').setRequired(false)
          )
          .addStringOption((opt) =>
            opt.setName('game_type').setDescription('Hypixel duel type (e.g., BedWars Duels)').setRequired(false)
          )
          .addIntegerOption((opt) =>
            opt.setName('best_of').setDescription('Best of X series (odd numbers)').setRequired(false)
          )
          .addIntegerOption((opt) =>
            opt.setName('players').setDescription('Number of fake players (default 8)').setRequired(false)
          )
          .addChannelOption((opt) =>
            opt
              .setName('category')
              .setDescription('Discord category to place tournament channels in')
              .addChannelTypes(ChannelType.GuildCategory)
              .setRequired(false)
          )
      )
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
          .setName('audit')
          .setDescription('View tournament audit log (Admin)')
          .addIntegerOption((opt) => opt.setName('tournament_id').setDescription('Tournament ID').setRequired(true))
          .addIntegerOption((opt) =>
            opt.setName('limit').setDescription('Number of entries (default 50)').setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('proof')
          .setDescription('Add a proof/replay URL to your match')
          .addIntegerOption((opt) => opt.setName('match_id').setDescription('Match ID').setRequired(true))
          .addStringOption((opt) =>
            opt.setName('url').setDescription('URL to proof (YouTube, Imgur, Twitch VOD, etc.)').setRequired(true)
          )
      ),

  permission: Permission.Anyone, // Anyone can join/leave/report, subcommands validate administrative privileges

  handler: async function (context) {
    const subcommand = context.interaction.options.getSubcommand()
    let bridgeId = context.bridgeId

    if ((subcommand === 'test' || subcommand === 'set-category' || subcommand === 'cancel') && bridgeId === undefined) {
      if (context.application.bridgeResolver.isMultiBridgeEnabled()) {
        const bridges = context.application.bridgeResolver.getAllBridges()
        bridgeId = bridges.length > 0 ? bridges[0].id : 'default'
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

    if (subcommand !== 'test' && subcommand !== 'set-category' && subcommand !== 'cancel') {
      const tournamentEnabled = context.application.core.bridgeConfigurations.getTournamentEnabled(bridgeId)
      if (!tournamentEnabled) {
        await context.interaction.reply({
          content: 'Tournaments are not enabled on this bridge.',
          ephemeral: true
        })
        return
      }
    }

    const isOfficer = context.permission >= Permission.Officer

    // 1. Create Tournament
    if (subcommand === 'create') {
      if (context.permission < Permission.Admin) {
        await context.interaction.reply({
          content: 'You do not have permission to create tournaments.',
          ephemeral: true
        })
        return
      }

      await context.interaction.deferReply()
      const name = context.interaction.options.getString('name', true)
      const gameType = context.interaction.options.getString('game_type', true)
      const bestOf =
        context.interaction.options.getInteger('best_of') ??
        context.application.core.bridgeConfigurations.getTournamentDefaultBestOf(bridgeId)
      const deadline =
        context.interaction.options.getInteger('deadline_hours') ??
        context.application.core.bridgeConfigurations.getTournamentDefaultDeadlineHours(bridgeId)

      if (bestOf % 2 === 0 || bestOf <= 0) {
        await context.interaction.editReply('Best of X series must be a positive odd number (e.g. 1, 3, 5).')
        return
      }

      try {
        const tournament = await context.application.core.tournamentManager.createTournament(
          bridgeId,
          name,
          gameType,
          bestOf,
          context.interaction.user.id,
          deadline
        )
        const embed = new EmbedBuilder()
          .setTitle('🏆 Tournament Created')
          .setColor('#00FF00')
          .setDescription(
            `Tournament **${tournament.name}** has been successfully created!\n\n` +
              `• **Game:** ${tournament.gameType}\n` +
              `• **Best Of:** ${tournament.bestOf}\n` +
              `• **Deadline per round:** ${tournament.roundDeadlineHours} hours\n\n` +
              `Players can now join using \`/tournament join\`!`
          )
          .setTimestamp()

        await context.interaction.editReply({ embeds: [embed] })

        // Try to post signup embed in notification channel
        const notificationChannelId =
          await context.application.core.bridgeConfigurations.getTournamentNotificationChannelId(bridgeId)
        if (notificationChannelId) {
          const channel = await context.interaction.guild?.channels.fetch(notificationChannelId).catch(() => null)
          if (channel?.isTextBased()) {
            const signupEmbed = new EmbedBuilder()
              .setTitle(`Sign up for ${name}`)
              .setDescription(
                `React with ✅ to join or ❌ to leave.\n\n**Game:** ${gameType}\n**Best of:** ${bestOf}\n**Format:** single-elim`
              )
              .setColor(0x3498db)
              .setFooter({ text: `React to join! Tournament ID: ${tournament.id}` })

            const signupMessage = await channel.send({ embeds: [signupEmbed] })
            await signupMessage.react('✅')
            await signupMessage.react('❌')
          }
        }
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 2. Join Tournament
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
          'You must link your Minecraft account first! Use `/verify` or contact an officer.'
        )
        return
      }

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

    // 3. Leave Tournament
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

      try {
        await context.application.core.tournamentManager.removePlayer(tournament.id, link.uuid)
        await context.interaction.editReply('✅ You have left the tournament.')
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 4. Start Tournament
    if (subcommand === 'start') {
      if (context.permission < Permission.Admin) {
        await context.interaction.reply({
          content: 'You do not have permission to start tournaments.',
          ephemeral: true
        })
        return
      }

      await context.interaction.deferReply()
      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Signup) {
        await context.interaction.editReply('There is no tournament in the signup phase.')
        return
      }

      const guildId = context.interaction.guildId
      if (guildId === null) {
        await context.interaction.editReply('Cannot start tournament outside of a Discord server.')
        return
      }

      try {
        await context.interaction.editReply('Generating bracket and creating channels... (This may take a moment)')
        await context.application.core.tournamentManager.startTournament(tournament.id, guildId)
        await context.interaction.editReply(
          '🏆 Bracket generated and matches activated! Check the new tournament channel.'
        )
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 5. Cancel Tournament
    if (subcommand === 'cancel') {
      if (context.permission < Permission.Admin) {
        await context.interaction.reply({
          content: 'You do not have permission to cancel tournaments.',
          ephemeral: true
        })
        return
      }

      await context.interaction.deferReply()
      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined) {
        await context.interaction.editReply('There is no active tournament to cancel.')
        return
      }

      try {
        await context.application.core.tournamentManager.cancelTournament(tournament.id)
        await context.interaction.editReply(
          '🔴 Tournament has been cancelled. Active match threads have been archived.'
        )
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 6. Status
    if (subcommand === 'status') {
      await context.interaction.deferReply()
      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined) {
        await context.interaction.editReply('There is no active tournament for this bridge.')
        return
      }

      // Fetch players
      const players = await context.application.core.databaseManager.queryRows<TournamentPlayer>(
        'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
        [tournament.id]
      )

      const embed = new EmbedBuilder()
        .setTitle(`🏆 Status: ${tournament.name}`)
        .setColor('#FFA500')
        .setDescription(
          `• **Game Type:** ${tournament.gameType}\n` +
            `• **Best Of:** ${tournament.bestOf}\n` +
            `• **Deadline per round:** ${tournament.roundDeadlineHours} hours\n` +
            `• **Current Status:** \`${tournament.status}\`\n` +
            `• **Current Round:** ${tournament.currentRound} / ${tournament.totalRounds}\n` +
            `• **Registered Players:** ${players.length}`
        )
        .setTimestamp()

      await context.interaction.editReply({ embeds: [embed] })
      return
    }

    // 7. Bracket Channel Link
    if (subcommand === 'bracket') {
      await context.interaction.deferReply()
      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament?.discordChannelId === undefined) {
        await context.interaction.editReply('There is no bracket channel active for this bridge.')
        return
      }

      await context.interaction.editReply(
        `🏆 The live tournament bracket can be viewed here: <#${tournament.discordChannelId}>`
      )
      return
    }

    // 8. Report Results
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

    // 9. Admin Force Confirm
    if (subcommand === 'confirm') {
      if (!isOfficer) {
        await context.interaction.reply({
          content: 'You do not have permission to force confirm matches.',
          ephemeral: true
        })
        return
      }

      await context.interaction.deferReply()
      const matchId = context.interaction.options.getInteger('match_id', true)
      const winnerName = context.interaction.options.getString('winner', true)

      const match = await context.application.core.databaseManager.queryOne<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1',
        [matchId]
      )
      if (match === undefined) {
        await context.interaction.editReply('Match not found.')
        return
      }

      // Find player by username
      const p1Profile =
        match.player1Id === undefined
          ? undefined
          : await context.application.core.databaseManager.queryOne<TournamentPlayer>(
              'SELECT * FROM "tournament_players" WHERE "id" = $1',
              [match.player1Id]
            )
      const p2Profile =
        match.player2Id === undefined
          ? undefined
          : await context.application.core.databaseManager.queryOne<TournamentPlayer>(
              'SELECT * FROM "tournament_players" WHERE "id" = $1',
              [match.player2Id]
            )

      let winnerId: number | undefined

      if (p1Profile !== undefined) {
        const mojang1 = await context.application.mojangApi.profileByUuid(p1Profile.playerUuid).catch(() => undefined)
        if (mojang1 !== undefined && mojang1.name.toLowerCase() === winnerName.toLowerCase()) {
          winnerId = p1Profile.id
        }
      }
      if (winnerId === undefined && p2Profile !== undefined) {
        const mojang2 = await context.application.mojangApi.profileByUuid(p2Profile.playerUuid).catch(() => undefined)
        if (mojang2 !== undefined && mojang2.name.toLowerCase() === winnerName.toLowerCase()) {
          winnerId = p2Profile.id
        }
      }

      if (winnerId === undefined) {
        await context.interaction.editReply(`Could not find active player with name "${winnerName}" in this match.`)
        return
      }

      try {
        await context.application.core.tournamentManager.matchManager.adminConfirm(matchId, winnerId)
        await context.interaction.editReply(`✅ Match ${matchId} winner has been forced to **${winnerName}**!`)
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 10. Open Check-in
    if (subcommand === 'open-checkin') {
      if (context.permission < Permission.Admin) {
        await context.interaction.reply({
          content: 'You do not have permission to open check-in.',
          ephemeral: true
        })
        return
      }

      await context.interaction.deferReply()
      const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
      if (tournament === undefined || tournament.status !== TournamentStatus.Signup) {
        await context.interaction.editReply('There is no tournament in the signup phase.')
        return
      }

      try {
        await context.application.core.tournamentManager.openCheckinManually(tournament.id)
        await context.interaction.editReply('✅ Check-in has been opened for the tournament!')
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 11. Check-in
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
          'You must link your Minecraft account first! Use `/verify` or contact an officer.'
        )
        return
      }

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

    // 12. Extend Deadline
    if (subcommand === 'extend') {
      if (!isOfficer) {
        await context.interaction.reply({
          content: 'You do not have permission to extend deadlines.',
          ephemeral: true
        })
        return
      }

      await context.interaction.deferReply()
      const matchId = context.interaction.options.getInteger('match_id', true)
      const hours = context.interaction.options.getInteger('hours', true)

      try {
        const maxExtensionHours = context.application.core.bridgeConfigurations.getTournamentMaxExtensionHours(bridgeId)
        const result = await context.application.core.tournamentManager.matchManager.extendDeadline(
          matchId,
          hours,
          maxExtensionHours
        )
        await context.interaction.editReply(
          `✅ Match ${matchId} deadline has been extended by ${hours} hours. New deadline: <t:${result.newDeadlineAt}:F>`
        )
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 13. Forfeit
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

      try {
        await context.application.core.tournamentManager.matchManager.forfeit(match.id, player.id)
        await context.interaction.editReply('Forfeit accepted.')
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 14. Set Tournament Category
    if (subcommand === 'set-category') {
      if (context.permission < Permission.Admin) {
        await context.interaction.reply({
          content: 'You do not have permission to change tournament settings.',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      if (bridgeId === undefined) {
        await context.interaction.reply({
          content: 'This command can only be used in a bridge channel.',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      const category = context.interaction.options.getChannel('category')
      if (category === null) {
        await context.interaction.reply({
          content: 'Please select a valid category channel.',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      context.application.core.bridgeConfigurations.setTournamentCategoryId(bridgeId, category.id)
      await context.interaction.reply({
        content: `Tournament category set to <#${category.id}>. All future tournaments will be placed inside this category.`,
        flags: MessageFlags.Ephemeral
      })
      return
    }

    // 15. Test Tournament
    if (subcommand === 'test') {
      if (context.permission < Permission.Admin) {
        await context.interaction.reply({
          content: 'This command is restricted to administrators.',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      await context.interaction.deferReply()

      try {
        const name = context.interaction.options.getString('name') ?? 'Test Tournament'
        const gameType = context.interaction.options.getString('game_type') ?? 'Bridge'
        const bestOf = context.interaction.options.getInteger('best_of') ?? 1
        const playerCount = context.interaction.options.getInteger('players') ?? 8

        if (playerCount < 2 || playerCount > 32) {
          await context.interaction.editReply('Player count must be between 2 and 32.')
          return
        }

        // Create tournament
        const tournament = await context.application.core.tournamentManager.createTournament(
          bridgeId,
          name,
          gameType,
          bestOf,
          context.interaction.user.id
        )

        // Seed fake players
        const fakePlayers: { id: number; playerUuid: string; seed: number }[] = []
        for (let index = 0; index < playerCount; index++) {
          const fakeUuid = `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`
          const now = Math.floor(Date.now() / 1000)
          const result = await context.application.core.databaseManager.queryOne<{
            id: number
            playerUuid: string
          }>(
            `INSERT INTO "tournament_players" ("tournamentId", "playerUuid", "discordId", "seed", "status", "checkedInAt")
             VALUES ($1, $2, NULL, $3, $4, $5)
             RETURNING "id", "playerUuid"`,
            [tournament.id, fakeUuid, index + 1, PlayerStatus.CheckedIn, now]
          )
          if (result !== undefined) {
            fakePlayers.push({ id: result.id, playerUuid: result.playerUuid, seed: index + 1 })
          }
        }

        const guildId = context.interaction.guildId
        if (guildId === null) {
          await context.interaction.editReply('Cannot create test tournament outside of a Discord server.')
          return
        }

        const categoryChannel = context.interaction.options.getChannel('category')
        const categoryId = categoryChannel?.id

        // Start the tournament
        await context.application.core.tournamentManager.startTournament(tournament.id, guildId, categoryId)

        // Get updated tournament
        const startedTournament = await context.application.core.tournamentManager.getTournament(tournament.id)
        if (startedTournament === undefined) {
          await context.interaction.editReply('Failed to start test tournament.')
          return
        }

        // Post random messages + scheduling in match threads
        const matches = await context.application.core.databaseManager.queryRows<TournamentMatch>(
          'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "round" = 1',
          [tournament.id]
        )

        for (const match of matches) {
          if (match.discordThreadId === undefined) continue
          try {
            const thread = await context.application.discordInstance.getClient().channels.fetch(match.discordThreadId)
            if (thread === null || !('send' in thread)) continue

            const messageCount = randomInt(3, 6)
            for (let m = 0; m < messageCount; m++) {
              await new Promise((resolve) => setTimeout(resolve, 500))
              const message = TestChatMessages[randomInt(0, TestChatMessages.length - 1)]
              void thread.send({ content: message }).catch(() => undefined)
            }

            // Simulate a scheduling message
            if (randomInt(0, 1) === 1) {
              await new Promise((resolve) => setTimeout(resolve, 500))
              const scheduleTime = SchedulingOptions[randomInt(0, SchedulingOptions.length - 1)]
              const parsed = chrono.parseDate(scheduleTime)
              if (parsed !== null) {
                const unix = Math.floor(parsed.getTime() / 1000)
                void thread
                  .send({
                    content: `📅 **Scheduling** — available <t:${unix}:F> (<t:${unix}:R>)\nUse \`/tournament schedule\` to post your own availability!`
                  })
                  .catch(() => undefined)
              }
            }
          } catch {
            // Thread may not exist, ignore
          }
        }

        // Store panel state
        const startedMatches = await context.application.core.databaseManager.queryRows<TournamentMatch>(
          'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
          [tournament.id]
        )

        // Build the control panel embed
        const names = await context.application.core.tournamentManager.getPlayerNames(tournament.id)

        const panelEmbed = new EmbedBuilder()
          .setTitle(`🏆 Test Tournament: ${tournament.name}`)
          .setColor('#FFA500')
          .setDescription(
            `• **Game:** ${tournament.gameType}\n` +
              `• **Best Of:** ${tournament.bestOf}\n` +
              `• **Players:** ${playerCount} (fake)\n` +
              `• **Status:** \`${startedTournament.status}\`\n` +
              `• **Round:** ${startedTournament.currentRound} / ${startedTournament.totalRounds}`
          )

        for (let r = 1; r <= startedTournament.totalRounds; r++) {
          const roundMatches = startedMatches
            .filter((m) => m.round === r)
            .toSorted((a, b) => a.matchIndex - b.matchIndex)
          let roundContent = ''
          for (const m of roundMatches) {
            const p1Name = m.player1Id === undefined ? '⏳' : (names.get(m.player1Id) ?? `P#${m.player1Id}`)
            const p2Name = m.player2Id === undefined ? '⏳' : (names.get(m.player2Id) ?? `P#${m.player2Id}`)
            let emoji = '⏳'
            switch (m.status) {
              case MatchStatus.Completed: {
                emoji = '✅'
                break
              }
              case MatchStatus.Active: {
                emoji = '🟢'
                break
              }
              case MatchStatus.Disputed: {
                emoji = '🔴'
                break
              }
              case MatchStatus.Bye: {
                {
                  emoji = '💤'
                  // No default
                }
                break
              }
            }
            roundContent += `${emoji} ${p1Name} vs ${p2Name}\n`
          }
          if (roundContent) panelEmbed.addFields({ name: `Round ${r}`, value: roundContent })
        }

        // Store panel state
        context.application.core.tournamentTestPanels.add({
          messageId: '',
          channelId: context.interaction.channelId,
          guildId,
          tournamentId: tournament.id,
          bridgeId,
          currentStep: 0,
          historyJson: '[]',
          createdAt: Date.now()
        })

        // Send the control panel and update the messageId
        const panelMessage = await context.interaction.editReply({
          embeds: [panelEmbed],
          components: [
            {
              type: 1,
              components: [
                { type: 2, style: 3, customId: `tournament-test:resolve-round:`, label: '▶ Resolve Round' },
                { type: 2, style: 1, customId: `tournament-test:resolve-match:`, label: '⏭ Resolve Match' },
                { type: 2, style: 2, customId: `tournament-test:rewind-round:`, label: '⏮ Rewind Round' },
                { type: 2, style: 2, customId: `tournament-test:rewind-all:`, label: '⏮ Rewind All' },
                { type: 2, style: 4, customId: `tournament-test:cleanup:`, label: '🗑 Cleanup' }
              ]
            }
          ]
        })

        // Update panel with message ID
        const panelEntries = context.application.core.tournamentTestPanels.getAll()
        const latestPanel = panelEntries.find((p) => p.tournamentId === tournament.id && p.messageId === '')
        if (latestPanel !== undefined) {
          context.application.core.tournamentTestPanels.remove('')
          context.application.core.tournamentTestPanels.add({
            ...latestPanel,
            messageId: panelMessage.id
          })

          // Update button customIds with the real messageId
          const components = [
            {
              type: 1 as const,
              components: [
                {
                  type: 2 as const,
                  style: 3,
                  customId: `tournament-test:resolve-round:${panelMessage.id}`,
                  label: '▶ Resolve Round'
                },
                {
                  type: 2 as const,
                  style: 1,
                  customId: `tournament-test:resolve-match:${panelMessage.id}`,
                  label: '⏭ Resolve Match'
                },
                {
                  type: 2 as const,
                  style: 2,
                  customId: `tournament-test:rewind-round:${panelMessage.id}`,
                  label: '⏮ Rewind Round'
                },
                {
                  type: 2 as const,
                  style: 2,
                  customId: `tournament-test:rewind-all:${panelMessage.id}`,
                  label: '⏮ Rewind All'
                },
                {
                  type: 2 as const,
                  style: 4,
                  customId: `tournament-test:cleanup:${panelMessage.id}`,
                  label: '🗑 Cleanup'
                }
              ]
            }
          ]
          await context.interaction.editReply({ components })
        }

        context.application.core.tournamentTestPanels.updateStep(panelMessage.id, 0, '[]')
      } catch (error: unknown) {
        await context.interaction.editReply(error instanceof Error ? error.message : String(error))
      }
      return
    }

    // 16. Schedule Availability
    if (subcommand === 'schedule') {
      const timeStr = context.interaction.options.getString('time', true)
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
        const parsed = chrono.parse(timeStr)
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
        if (match !== undefined && match.discordThreadId !== undefined) {
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

    // 17. Audit Log
    if (subcommand === 'audit') {
      if (context.permission < Permission.Admin) {
        await context.interaction.reply({
          content: 'This command is restricted to administrators.',
          flags: MessageFlags.Ephemeral
        })
        return
      }

      const tournamentId = context.interaction.options.getInteger('tournament_id', true)
      const limit = context.interaction.options.getInteger('limit') ?? 50

      try {
        const logs = await context.application.core.tournamentManager.auditLogger.getLogs(tournamentId, limit)
        if (logs.length === 0) {
          await context.interaction.reply({
            content: 'No audit entries found for this tournament.',
            flags: MessageFlags.Ephemeral
          })
          return
        }

        const embed = new EmbedBuilder()
          .setTitle(`Tournament Audit Log (#${tournamentId})`)
          .setColor(0x2ecc71)
          .setDescription(
            logs
              .slice(0, 10)
              .map(
                (log: any) =>
                  `**${log.action}** — <@${log.actor_discord_id}> — ${new Date(log.created_at).toLocaleString()}`
              )
              .join('\n')
          )
          .setFooter({ text: `Showing ${Math.min(logs.length, 10)} of ${logs.length} entries` })

        await context.interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
      } catch (error) {
        await context.interaction.reply({
          content: `Error loading audit log: ${error instanceof Error ? error.message : String(error)}`,
          flags: MessageFlags.Ephemeral
        })
      }
      return
    }

    // 18. Proof Attachment
    if (subcommand === 'proof') {
      const matchId = context.interaction.options.getInteger('match_id', true)
      const url = context.interaction.options.getString('url', true)

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
  },

  autoComplete: async function (context) {
    const focused = context.interaction.options.getFocused(true)
    const bridgeId = context.bridgeId
    if (bridgeId === undefined) return

    const tournament = context.application.core.tournamentManager.getActiveTournament(bridgeId)
    if (tournament === undefined) return

    if (focused.name === 'match_id') {
      // Find active disputed matches
      const disputed = await context.application.core.databaseManager.queryRows<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "status" = $2',
        [tournament.id, MatchStatus.Disputed]
      )

      const names = await context.application.core.tournamentManager.getPlayerNames(tournament.id)
      const options = disputed.map((m) => {
        const p1Name = m.player1Id === undefined ? 'Player 1' : (names.get(m.player1Id) ?? 'Player 1')
        const p2Name = m.player2Id === undefined ? 'Player 2' : (names.get(m.player2Id) ?? 'Player 2')
        return {
          name: `Match #${m.id}: ${p1Name} vs ${p2Name}`,
          value: m.id
        }
      })

      await context.interaction.respond(options.slice(0, 25))
    }

    if (focused.name === 'winner') {
      const matchId = context.interaction.options.getInteger('match_id')
      if (matchId === null) return

      const match = await context.application.core.databaseManager.queryOne<TournamentMatch>(
        'SELECT * FROM "tournament_matches" WHERE "id" = $1',
        [matchId]
      )
      if (match === undefined) return

      const names = await context.application.core.tournamentManager.getPlayerNames(tournament.id)
      const choices: string[] = []
      if (match.player1Id !== undefined) {
        const n1 = names.get(match.player1Id)
        if (n1 !== undefined) choices.push(n1)
      }
      if (match.player2Id !== undefined) {
        const n2 = names.get(match.player2Id)
        if (n2 !== undefined) choices.push(n2)
      }

      await context.interaction.respond(
        choices
          .filter((name) => name.toLowerCase().includes(focused.value.toLowerCase()))
          .map((name) => ({ name, value: name }))
      )
    }
  }
} satisfies DiscordCommandHandler
