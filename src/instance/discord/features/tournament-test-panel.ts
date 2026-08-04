import type { ButtonInteraction, Client } from 'discord.js'
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js'

import type { InstanceType } from '../../../common/application-event.js'
import SubInstance from '../../../common/sub-instance.js'
import type { TournamentTestPanelEntry } from '../../../core/tournament/tournament-test-panels.js'
import { MatchStatus, TournamentStatus } from '../../../core/tournament/types.js'
import type { Tournament, TournamentMatch, TournamentPlayer } from '../../../core/tournament/types.js'
import type DiscordInstance from '../discord-instance.js'

interface HistoryEntry {
  round: number
  matchIds: number[]
  previousStatuses: { matchId: number; status: string }[]
}

export default class TournamentTestPanel extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  private static readonly Prefix = 'tournament-test'

  constructor(clientInstance: DiscordInstance) {
    super(clientInstance)

    this.application.logger.info('TournamentTestPanel: Initialized')

    const client = this.clientInstance.getClient()
    client.on('interactionCreate', (interaction) => {
      if (!interaction.isButton() || !interaction.isMessageComponent()) return
      if (!interaction.customId.startsWith(`${TournamentTestPanel.Prefix}:`)) return

      void this.handleButton(interaction).catch(this.errorHandler.promiseCatch('handling tournament test panel button'))
    })
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply()

    const parts = interaction.customId.split(':')
    if (parts.length < 3) {
      this.application.logger.info(`TournamentTestPanel: Invalid button customId: ${interaction.customId}`)
      await interaction.editReply({ content: 'Invalid button.' })
      return
    }

    const action = parts[1]
    const panelMessageId = parts[2]

    this.application.logger.info(`TournamentTestPanel: Button pressed — action=${action}, panel=${panelMessageId}`)

    const panel = this.application.core.tournamentTestPanels.get(panelMessageId)
    if (panel === undefined) {
      this.application.logger.info(`TournamentTestPanel: Panel ${panelMessageId} not found`)
      await interaction.editReply({ content: 'This test panel is no longer active.' })
      return
    }

    switch (action) {
      case 'resolve-round': {
        await this.handleResolveRound(interaction, panel)
        break
      }
      case 'resolve-match': {
        await this.handleResolveMatch(interaction, panel)
        break
      }
      case 'simulate-dispute': {
        await this.handleSimulateDispute(interaction, panel)
        break
      }
      case 'rewind-round': {
        await this.handleRewindRound(interaction, panel)
        break
      }
      case 'rewind-all': {
        await this.handleRewindAll(interaction, panel)
        break
      }
      case 'cleanup': {
        await this.handleCleanup(interaction, panel)
        break
      }
      default: {
        await interaction.editReply({ content: `Unknown action: ${action}` })
      }
    }
  }

  private buildControlPanelEmbed(
    tournament: Tournament,
    matches: TournamentMatch[],
    players: TournamentPlayer[],
    panel: TournamentTestPanelEntry
  ): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
    const statusEmoji: Record<string, string> = {
      [MatchStatus.Completed]: '✅',
      [MatchStatus.Active]: '🟢',
      [MatchStatus.Pending]: '⏳',
      [MatchStatus.Bye]: '💤',
      [MatchStatus.Disputed]: '🔴',
      [MatchStatus.Reported]: '🟡',
      [MatchStatus.BothConfirmed]: '🟢'
    }

    let description = `**Game:** ${tournament.gameType}\n`
    description += `**Best of:** ${tournament.bestOf}\n`
    description += `**Status:** ${tournament.status}\n`
    description += `**Round:** ${tournament.currentRound}/${tournament.totalRounds}\n`
    description += `**Players:** ${players.length}`

    const embed = new EmbedBuilder().setTitle(`🏆 Test Tournament: ${tournament.name}`).setDescription(description)

    for (let round = 1; round <= tournament.totalRounds; round++) {
      const roundMatches = matches.filter((m) => m.round === round)
      if (roundMatches.length === 0) continue

      const lines = roundMatches.map((m) => {
        const emoji = statusEmoji[m.status] ?? '❓'
        const p1Name = players.find((p) => p.id === m.player1Id)?.playerUuid.slice(0, 8) ?? 'TBD'
        const p2Name = players.find((p) => p.id === m.player2Id)?.playerUuid.slice(0, 8) ?? 'TBD'
        return `${emoji} **#${m.id}**: ${p1Name} vs ${p2Name}`
      })

      embed.addFields({ name: `Round ${round}`, value: lines.join('\n') || '—', inline: false })
    }

    embed.setFooter({ text: 'Test mode — buttons below control the bracket' })

    const isCompleted = tournament.status === TournamentStatus.Completed
    const canRewind = panel.currentStep > 0

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${TournamentTestPanel.Prefix}:resolve-round:${panel.messageId}`)
        .setLabel('Resolve Round')
        .setStyle(ButtonStyle.Success)
        .setEmoji('▶')
        .setDisabled(isCompleted),
      new ButtonBuilder()
        .setCustomId(`${TournamentTestPanel.Prefix}:resolve-match:${panel.messageId}`)
        .setLabel('Resolve Match')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('⏭')
        .setDisabled(isCompleted),
      new ButtonBuilder()
        .setCustomId(`${TournamentTestPanel.Prefix}:simulate-dispute:${panel.messageId}`)
        .setLabel('Dispute Match')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⚡')
        .setDisabled(isCompleted),
      new ButtonBuilder()
        .setCustomId(`${TournamentTestPanel.Prefix}:rewind-round:${panel.messageId}`)
        .setLabel('Rewind Round')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏮')
        .setDisabled(!canRewind),
      new ButtonBuilder()
        .setCustomId(`${TournamentTestPanel.Prefix}:rewind-all:${panel.messageId}`)
        .setLabel('Rewind All')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏮')
        .setDisabled(!canRewind)
    )

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${TournamentTestPanel.Prefix}:cleanup:${panel.messageId}`)
        .setLabel('Cleanup')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑')
    )

    return { embed, components: [row1, row2] }
  }

  private async refreshPanel(interaction: ButtonInteraction, panel: TournamentTestPanelEntry): Promise<void> {
    const tournament = await this.application.core.tournamentManager.getTournament(panel.tournamentId)
    if (tournament === undefined) {
      await interaction.editReply({ content: 'Tournament no longer exists.', embeds: [], components: [] })
      return
    }

    const matches = await this.application.core.databaseManager.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
      [tournament.id]
    )
    const players = await this.application.core.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournament.id]
    )

    const { embed, components } = this.buildControlPanelEmbed(tournament, matches, players, panel)

    await interaction.editReply({ embeds: [embed], components })
  }

  private async handleResolveRound(interaction: ButtonInteraction, panel: TournamentTestPanelEntry): Promise<void> {
    this.application.logger.info(`TournamentTestPanel: Resolving round for tournament ${panel.tournamentId}`)
    const tournament = await this.application.core.tournamentManager.getTournament(panel.tournamentId)
    if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
      await interaction.editReply({ content: 'Tournament is not active.' })
      return
    }

    const activeMatches = await this.application.core.databaseManager.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "round" = $2 AND "status" = $3',
      [tournament.id, tournament.currentRound, MatchStatus.Active]
    )

    if (activeMatches.length === 0) {
      this.application.logger.info(`TournamentTestPanel: No active matches in round ${tournament.currentRound}`)
      await interaction.editReply({ content: 'No active matches in the current round to resolve.' })
      return
    }

    const players = await this.application.core.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournament.id]
    )

    const previousStatuses: { matchId: number; status: string }[] = []

    for (const match of activeMatches) {
      if (match.player1Id === undefined || match.player2Id === undefined) continue

      const player1 = players.find((p) => p.id === match.player1Id)
      const player2 = players.find((p) => p.id === match.player2Id)
      if (player1 === undefined || player2 === undefined) continue

      const winnerId = player1.seed < player2.seed ? player1.id : player2.id
      previousStatuses.push({ matchId: match.id, status: match.status })

      const targetWins = Math.ceil(tournament.bestOf / 2)
      const p1Wins = winnerId === player1.id ? targetWins : 0
      const p2Wins = winnerId === player2.id ? targetWins : 0

      await this.application.core.tournamentManager.matchManager
        .submitReport(match.id, match.player1Id, winnerId, p1Wins, p2Wins)
        .catch((error: unknown) => {
          this.application.logger.error(`TournamentTestPanel: submitReport player1 failed for match ${match.id}`, error)
        })
      await this.application.core.tournamentManager.matchManager
        .submitReport(match.id, match.player2Id, winnerId, p1Wins, p2Wins)
        .catch((error: unknown) => {
          this.application.logger.error(`TournamentTestPanel: submitReport player2 failed for match ${match.id}`, error)
        })

      await this.application.core.tournamentManager.auditLogger.log(
        tournament.id,
        'test_resolve_match',
        interaction.user.id,
        match.id,
        undefined,
        { winnerId, p1Wins, p2Wins }
      )
    }

    const history: HistoryEntry[] = JSON.parse(panel.historyJson) as HistoryEntry[]
    history.push({
      round: tournament.currentRound,
      matchIds: activeMatches.map((m) => m.id),
      previousStatuses
    })

    const newStep = panel.currentStep + 1
    this.application.core.tournamentTestPanels.updateStep(panel.messageId, newStep, JSON.stringify(history))

    const updatedPanel = this.application.core.tournamentTestPanels.get(panel.messageId)
    if (updatedPanel !== undefined) {
      await this.refreshPanel(interaction, updatedPanel)
    }
  }

  private async handleResolveMatch(interaction: ButtonInteraction, panel: TournamentTestPanelEntry): Promise<void> {
    this.application.logger.info(`TournamentTestPanel: Resolving match for tournament ${panel.tournamentId}`)
    const tournament = await this.application.core.tournamentManager.getTournament(panel.tournamentId)
    if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
      await interaction.editReply({ content: 'Tournament is not active.' })
      return
    }

    const activeMatch = await this.application.core.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "round" = $2 AND "status" = $3 ORDER BY "matchIndex" ASC LIMIT 1',
      [tournament.id, tournament.currentRound, MatchStatus.Active]
    )

    if (activeMatch === undefined) {
      this.application.logger.info(`TournamentTestPanel: No active match in round ${tournament.currentRound}`)
      await interaction.editReply({ content: 'No active matches in the current round to resolve.' })
      return
    }

    if (activeMatch.player1Id === undefined || activeMatch.player2Id === undefined) {
      await interaction.editReply({ content: 'Match has missing players.' })
      return
    }

    const players = await this.application.core.databaseManager.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournament.id]
    )

    const player1 = players.find((p) => p.id === activeMatch.player1Id)
    const player2 = players.find((p) => p.id === activeMatch.player2Id)

    if (player1 === undefined || player2 === undefined) {
      await interaction.editReply({ content: 'Could not find both players for the match.' })
      return
    }

    const winnerId = player1.seed < player2.seed ? player1.id : player2.id

    const targetWins = Math.ceil(tournament.bestOf / 2)
    const p1Wins = winnerId === player1.id ? targetWins : 0
    const p2Wins = winnerId === player2.id ? targetWins : 0

    await this.application.core.tournamentManager.matchManager
      .submitReport(activeMatch.id, activeMatch.player1Id, winnerId, p1Wins, p2Wins)
      .catch((error: unknown) => {
        this.application.logger.error(
          `TournamentTestPanel: submitReport player1 failed for match ${activeMatch.id}`,
          error
        )
      })
    await this.application.core.tournamentManager.matchManager
      .submitReport(activeMatch.id, activeMatch.player2Id, winnerId, p1Wins, p2Wins)
      .catch((error: unknown) => {
        this.application.logger.error(
          `TournamentTestPanel: submitReport player2 failed for match ${activeMatch.id}`,
          error
        )
      })

    await this.application.core.tournamentManager.auditLogger.log(
      tournament.id,
      'test_resolve_match',
      interaction.user.id,
      activeMatch.id,
      undefined,
      { winnerId, p1Wins, p2Wins }
    )

    const history: HistoryEntry[] = JSON.parse(panel.historyJson) as HistoryEntry[]
    history.push({
      round: tournament.currentRound,
      matchIds: [activeMatch.id],
      previousStatuses: [{ matchId: activeMatch.id, status: activeMatch.status }]
    })

    const newStep = panel.currentStep + 1
    this.application.core.tournamentTestPanels.updateStep(panel.messageId, newStep, JSON.stringify(history))

    const updatedPanel = this.application.core.tournamentTestPanels.get(panel.messageId)
    if (updatedPanel !== undefined) {
      await this.refreshPanel(interaction, updatedPanel)
    }
  }

  private async handleSimulateDispute(interaction: ButtonInteraction, panel: TournamentTestPanelEntry): Promise<void> {
    this.application.logger.info(`TournamentTestPanel: Simulating dispute for tournament ${panel.tournamentId}`)
    const tournament = await this.application.core.tournamentManager.getTournament(panel.tournamentId)
    if (tournament === undefined || tournament.status !== TournamentStatus.Active) {
      await interaction.editReply({ content: 'Tournament is not active.' })
      return
    }

    const activeMatch = await this.application.core.databaseManager.queryOne<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1 AND "round" = $2 AND "status" = $3 ORDER BY "matchIndex" ASC LIMIT 1',
      [tournament.id, tournament.currentRound, MatchStatus.Active]
    )

    if (activeMatch?.player1Id === undefined || activeMatch.player2Id === undefined) {
      await interaction.editReply({ content: 'No active match in current round available to dispute.' })
      return
    }

    // Automatically post evidence into the thread if thread exists
    if (activeMatch.discordThreadId !== undefined) {
      try {
        const client = this.clientInstance.getClient()
        const thread = await client.channels.fetch(activeMatch.discordThreadId).catch(() => undefined)
        if (thread?.isTextBased() && 'send' in thread) {
          void thread
            .send({
              content: `📷 **Dispute Evidence Submitted:** https://imgur.com/a/dispute-proof-match-${activeMatch.id}`
            })
            .catch(() => undefined)
        }
      } catch {
        // Thread fetch fail, ignore
      }
    }

    const targetWins = Math.ceil(tournament.bestOf / 2)

    // Player 1 claims Player 1 won
    await this.application.core.tournamentManager.matchManager
      .submitReport(activeMatch.id, activeMatch.player1Id, activeMatch.player1Id, targetWins, 0)
      .catch((error: unknown) => {
        this.application.logger.error(`TournamentTestPanel: dispute submitReport p1 failed`, error)
      })

    // Player 2 claims Player 2 won
    await this.application.core.tournamentManager.matchManager
      .submitReport(activeMatch.id, activeMatch.player2Id, activeMatch.player2Id, 0, targetWins)
      .catch((error: unknown) => {
        this.application.logger.error(`TournamentTestPanel: dispute submitReport p2 failed`, error)
      })

    await this.application.core.tournamentManager.auditLogger.log(
      tournament.id,
      'test_simulate_dispute',
      interaction.user.id,
      activeMatch.id
    )

    const updatedPanel = this.application.core.tournamentTestPanels.get(panel.messageId)
    if (updatedPanel !== undefined) {
      await this.refreshPanel(interaction, updatedPanel)
    }
  }

  private async handleRewindRound(interaction: ButtonInteraction, panel: TournamentTestPanelEntry): Promise<void> {
    this.application.logger.info(
      `TournamentTestPanel: Rewinding round for panel ${panel.messageId} (step ${panel.currentStep} -> ${panel.currentStep - 1})`
    )
    if (panel.currentStep === 0) {
      await interaction.editReply({ content: 'Nothing to rewind.' })
      return
    }

    const history: HistoryEntry[] = JSON.parse(panel.historyJson) as HistoryEntry[]
    const entry = history.pop()
    if (entry === undefined) {
      await interaction.editReply({ content: 'History is empty.' })
      return
    }

    const database = this.application.core.databaseManager
    const client = this.clientInstance.getClient()

    for (const matchId of entry.matchIds) {
      await database.execute(
        'UPDATE "tournament_matches" SET "status" = $1, "winnerId" = NULL, "completedAt" = NULL, "player1Wins" = 0, "player2Wins" = 0 WHERE "id" = $2',
        [MatchStatus.Active, matchId]
      )
      await database.execute('DELETE FROM "tournament_reports" WHERE "matchId" = $1', [matchId])

      const match = await database.queryOne<TournamentMatch>('SELECT * FROM "tournament_matches" WHERE "id" = $1', [
        matchId
      ])
      if (match === undefined) continue

      const loserId = match.player1Id === match.winnerId ? match.player2Id : match.player1Id
      if (loserId !== undefined) {
        await database.execute('UPDATE "tournament_players" SET "status" = $1 WHERE "id" = $2', ['ACTIVE', loserId])
      }

      if (match.nextMatchId !== undefined) {
        const nextMatch = await database.queryOne<TournamentMatch>(
          'SELECT * FROM "tournament_matches" WHERE "id" = $1',
          [match.nextMatchId]
        )
        if (nextMatch !== undefined) {
          const slotField = nextMatch.matchIndex % 2 === 0 ? 'player1Id' : 'player2Id'
          await database.execute(`UPDATE "tournament_matches" SET "${slotField}" = NULL WHERE "id" = $1`, [
            nextMatch.id
          ])
          await database.execute('UPDATE "tournament_matches" SET "status" = $1, "deadlineAt" = NULL WHERE "id" = $2', [
            MatchStatus.Pending,
            nextMatch.id
          ])

          if (nextMatch.discordThreadId !== undefined) {
            await client.channels
              .fetch(nextMatch.discordThreadId)
              .then((ch) => {
                ch?.delete().catch(() => undefined)
              })
              .catch(() => undefined)
          }
        }
      }

      if (match.discordThreadId !== undefined) {
        await client.channels
          .fetch(match.discordThreadId)
          .then((ch) => {
            ch?.delete().catch(() => undefined)
          })
          .catch(() => undefined)
      }
    }

    await database.execute('UPDATE "tournaments" SET "currentRound" = $1, "status" = $2 WHERE "id" = $3', [
      entry.round,
      TournamentStatus.Active,
      panel.tournamentId
    ])

    const newStep = panel.currentStep - 1
    this.application.core.tournamentTestPanels.updateStep(panel.messageId, newStep, JSON.stringify(history))

    await this.application.core.tournamentManager.auditLogger.log(
      panel.tournamentId,
      'test_rewind_round',
      interaction.user.id,
      undefined,
      undefined,
      { round: entry.round }
    )

    const updatedPanel = this.application.core.tournamentTestPanels.get(panel.messageId)
    if (updatedPanel !== undefined) {
      const refreshed = await this.application.core.tournamentManager.getTournament(panel.tournamentId)
      if (refreshed !== undefined) {
        await this.refreshBracketEmbed(refreshed)
      }
      await this.refreshPanel(interaction, updatedPanel)
    }
  }

  private async handleRewindAll(interaction: ButtonInteraction, panel: TournamentTestPanelEntry): Promise<void> {
    this.application.logger.info(`TournamentTestPanel: Rewinding all for panel ${panel.messageId}`)
    let currentPanel: TournamentTestPanelEntry | undefined = { ...panel }

    while (currentPanel !== undefined && currentPanel.currentStep > 0) {
      await this.handleRewindRound(interaction, currentPanel)
      currentPanel = this.application.core.tournamentTestPanels.get(panel.messageId)
    }

    await this.application.core.tournamentManager.auditLogger.log(
      panel.tournamentId,
      'test_rewind_all',
      interaction.user.id
    )

    if (currentPanel !== undefined) {
      await this.refreshPanel(interaction, currentPanel)
    }
  }

  private async handleCleanup(interaction: ButtonInteraction, panel: TournamentTestPanelEntry): Promise<void> {
    this.application.logger.info(
      `TournamentTestPanel: Cleaning up tournament ${panel.tournamentId}, panel ${panel.messageId}`
    )
    await this.application.core.tournamentManager.auditLogger.log(
      panel.tournamentId,
      'test_cleanup',
      interaction.user.id
    )

    await this.application.core.tournamentManager.cancelTournament(panel.tournamentId).catch(() => undefined)

    await this.application.core.databaseManager.execute('DELETE FROM "tournament_players" WHERE "tournamentId" = $1', [
      panel.tournamentId
    ])

    this.application.core.tournamentTestPanels.remove(panel.messageId)

    await interaction.message.delete().catch(() => undefined)

    await interaction.editReply({
      content: '🧹 Test tournament cleaned up.',
      embeds: [],
      components: []
    })
  }

  private async refreshBracketEmbed(tournament: Tournament): Promise<void> {
    if (tournament.discordChannelId === undefined || tournament.bracketMessageId === undefined) return

    const database = this.application.core.databaseManager
    const matches = await database.queryRows<TournamentMatch>(
      'SELECT * FROM "tournament_matches" WHERE "tournamentId" = $1',
      [tournament.id]
    )
    const players = await database.queryRows<TournamentPlayer>(
      'SELECT * FROM "tournament_players" WHERE "tournamentId" = $1',
      [tournament.id]
    )
    const names = await this.application.core.tournamentManager.getPlayerNames(tournament.id)

    await this.application.core.tournamentManager.channelManager.updateBracketEmbed(
      tournament.discordChannelId,
      tournament.bracketMessageId,
      tournament,
      matches,
      players,
      names
    )
  }
}
