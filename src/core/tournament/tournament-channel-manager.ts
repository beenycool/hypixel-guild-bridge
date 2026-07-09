import { ChannelType, EmbedBuilder, type AnyThreadChannel, type TextChannel, type ThreadChannel } from 'discord.js'

import type Application from '../../application.js'
import { CircuitBreaker } from '../../utility/circuit-breaker.js'
import RateLimiter from '../../utility/rate-limiter.js'

import type { Tournament, TournamentMatch, TournamentPlayer } from './types.js'
import { MatchStatus, TournamentStatus } from './types.js'

export class TournamentChannelManager {
  private readonly threadCreationLimiter = new RateLimiter(5, 10_000)
  private readonly circuitBreaker = new CircuitBreaker(3, 15_000)

  constructor(private readonly application: Application) {}

  /**
   * Creates a read-only parent channel for the bracket display.
   */
  public async createBracketChannel(
    guildId: string,
    tournamentName: string,
    parentCategoryId?: string
  ): Promise<TextChannel | undefined> {
    const client = this.application.discordInstance.getClient()
    const guild = await client.guilds.fetch(guildId).catch(() => undefined)
    if (guild === undefined) return undefined

    const channelName = `🏆-${tournamentName.toLowerCase().replaceAll(/\s+/g, '-')}`
    const channel = await guild.channels
      .create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentCategoryId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: ['ViewChannel', 'SendMessages']
          }
        ],
        reason: `Tournament ${tournamentName} bracket channel`
      })
      .catch(() => undefined)

    return channel
  }

  public async createTournamentCategory(guildId: string, tournamentName: string): Promise<string | undefined> {
    const client = this.application.discordInstance.getClient()
    const guild = await client.guilds.fetch(guildId).catch(() => undefined)
    if (guild === undefined) return undefined
    const category = await guild.channels
      .create({
        name: `🏆 ${tournamentName}`,
        type: ChannelType.GuildCategory,
        reason: `Tournament ${tournamentName} category`
      })
      .catch(() => undefined)
    return category?.id
  }

  public async createLiveChannel(
    guildId: string,
    tournamentName: string,
    categoryId: string
  ): Promise<string | undefined> {
    const client = this.application.discordInstance.getClient()
    const guild = await client.guilds.fetch(guildId).catch(() => undefined)
    if (guild === undefined) return undefined
    const slug = tournamentName.toLowerCase().replaceAll(/\s+/g, '-')
    const channel = await guild.channels
      .create({
        name: `🏆-${slug}-live`,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: ['ViewChannel', 'SendMessages']
          }
        ],
        reason: `Tournament ${tournamentName} live updates`
      })
      .catch(() => undefined)
    return channel?.id
  }

  public async archiveTournamentCategory(tournament: Tournament): Promise<void> {
    if (tournament.categoryChannelId === undefined) return
    const client = this.application.discordInstance.getClient()
    if (tournament.discordChannelId) {
      const bracketChannel = await client.channels.fetch(tournament.discordChannelId).catch(() => undefined)
      if (bracketChannel?.type === ChannelType.GuildText) {
        await bracketChannel.setName(`✅-archived-${bracketChannel.name}`).catch(() => undefined)
      }
    }
    if (tournament.liveChannelId) {
      const liveChannel = await client.channels.fetch(tournament.liveChannelId).catch(() => undefined)
      if (liveChannel?.type === ChannelType.GuildText) {
        await liveChannel.delete().catch(() => undefined)
      }
    }
    const category = await client.channels.fetch(tournament.categoryChannelId).catch(() => undefined)
    if (category?.type === ChannelType.GuildCategory) {
      await category.delete().catch(() => undefined)
    }
  }

  private async addMemberWithRetry(thread: AnyThreadChannel, userId: string): Promise<void> {
    await this.threadCreationLimiter.wait()
    await this.circuitBreaker.execute(async () => {
      await thread.members.add(userId)
    })
  }

  /**
   * Spawns a private match thread for a given match.
   */
  public async createMatchThread(
    parentChannelId: string,
    match: TournamentMatch,
    player1: TournamentPlayer,
    player2: TournamentPlayer,
    p1Name: string,
    p2Name: string
  ): Promise<string | undefined> {
    const client = this.application.discordInstance.getClient()
    const channel = await client.channels.fetch(parentChannelId).catch(() => undefined)
    if (!channel || channel.type !== ChannelType.GuildText) return undefined

    const textChannel = channel
    const threadName = `Round ${match.round} - Match ${match.matchIndex + 1}: ${p1Name} vs ${p2Name}`

    // Create private thread
    const thread = await textChannel.threads
      .create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: ChannelType.PrivateThread,
        reason: `Match thread for ${p1Name} vs ${p2Name}`
      })
      .catch(() => undefined)

    if (thread === undefined) return undefined

    // Add players to thread if their discord ID is linked
    if (player1.discordId !== undefined) {
      await this.addMemberWithRetry(thread, player1.discordId)
    }
    if (player2.discordId !== undefined) {
      await this.addMemberWithRetry(thread, player2.discordId)
    }

    // Send initial instructional message in the thread
    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Match Thread: ${p1Name} vs ${p2Name}`)
      .setColor('#FFA500')
      .setDescription(
        `Welcome to your tournament match! Please schedule and play your Best-of-X series.\n\n` +
          `**Match Details:**\n` +
          `• **Round:** ${match.round}\n` +
          `• **Opponents:** ${p1Name} vs ${p2Name}\n` +
          `• **Deadline:** ${match.deadlineAt === undefined ? 'No deadline' : `<t:${match.deadlineAt}:F> (<t:${match.deadlineAt}:R>)`}\n\n` +
          `**How to Report Results:**\n` +
          `Once the match is complete, either player should run:\n` +
          `\`/tournament report winner:[me/opponent] my_wins:[wins] their_wins:[losses]\`\n\n` +
          `*Note: Both players must report the match. If the reports do not match, the match will enter a DISPUTED state, and a moderator will resolve it.*`
      )
      .setTimestamp()

    await thread
      .send({
        content: `${player1.discordId === undefined ? p1Name : `<@${player1.discordId}>`} vs ${player2.discordId === undefined ? p2Name : `<@${player2.discordId}>`}`,
        embeds: [embed]
      })
      .catch(() => undefined)

    return thread.id
  }

  private buildMatchEmbed(
    p1: string,
    p2: string,
    round: number,
    bestOf: number,
    gameMode: string,
    deadline: string,
    mcAccount1?: string,
    mcAccount2?: string
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Round ${round} — ${p1} vs ${p2}`)
      .setColor('#FFA500')
      .setDescription(
        `Welcome to your tournament match! Please schedule and play your Best-of-${bestOf} series.\n\n` +
          `**Match Details:**\n` +
          `• **Round:** ${round}\n` +
          `• **Opponents:** ${p1} vs ${p2}\n` +
          `• **Game Mode:** ${gameMode}\n` +
          `• **Deadline:** ${deadline}\n`
      )
      .setTimestamp()

    if (mcAccount1 !== undefined) {
      embed.addFields({ name: `${p1}'s MC Account`, value: mcAccount1, inline: true })
    }
    if (mcAccount2 !== undefined) {
      embed.addFields({ name: `${p2}'s MC Account`, value: mcAccount2, inline: true })
    }

    return embed
  }

  /**
   * Create a forum post for a match within a forum channel.
   * Discord Forum channels (type 15) support nested threads.
   */
  async createMatchForumPost(
    forumChannelId: string,
    match: TournamentMatch,
    p1: string,
    p2: string,
    round: number,
    bestOf: number,
    gameMode: string,
    deadline: string,
    discordId1?: string,
    discordId2?: string,
    mcAccount1?: string,
    mcAccount2?: string
  ): Promise<string | undefined> {
    try {
      const client = this.application.discordInstance.getClient()
      const guild = client.guilds.cache.first()
      if (guild === undefined) return undefined

      const forum = guild.channels.cache.get(forumChannelId)
      if (forum?.isThreadOnly() !== true) return undefined

      const title = `Round ${round} — ${p1} vs ${p2}`
      const embed = this.buildMatchEmbed(p1, p2, round, bestOf, gameMode, deadline, mcAccount1, mcAccount2)

      const thread = await forum.threads.create({
        name: title,
        message: { embeds: [embed] },
        reason: `Tournament match thread for ${p1} vs ${p2}`
      })

      if (discordId1 !== undefined) {
        await this.addMemberWithRetry(thread, discordId1)
      }
      if (discordId2 !== undefined) {
        await this.addMemberWithRetry(thread, discordId2)
      }

      return thread.id
    } catch (error) {
      this.application.logger.error('Failed to create forum post', error)
      return undefined
    }
  }

  private async archiveThreadWithRetry(threadId: string, resultMessage?: string): Promise<void> {
    await this.circuitBreaker.execute(async () => {
      const client = this.application.discordInstance.getClient()
      const thread = await client.channels.fetch(threadId).catch(() => undefined)
      if (!thread || (thread.type !== ChannelType.PrivateThread && thread.type !== ChannelType.PublicThread)) return

      const threadChannel = thread as ThreadChannel
      const embed = new EmbedBuilder()
        .setTitle('🏁 Match Completed')
        .setColor('#00FF00')
        .setDescription(resultMessage ?? '')
        .setTimestamp()

      await threadChannel.send({ embeds: [embed] }).catch(() => undefined)
      await threadChannel.setLocked(true).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await threadChannel.setArchived(true).catch(() => undefined)
    })
  }

  /**
   * Archives and locks a match thread when completed.
   */
  public async archiveMatchThread(threadId: string, resultMessage: string): Promise<void> {
    await this.archiveThreadWithRetry(threadId, resultMessage)
  }

  public async checkProofAttachment(threadId: string): Promise<boolean> {
    const client = this.application.discordInstance.getClient()
    const thread = await client.channels.fetch(threadId).catch(() => undefined)
    if (!thread?.isTextBased()) return false
    const messages = await thread.messages.fetch({ limit: 50 }).catch(() => undefined)
    if (messages === undefined || messages === null) return false
    return messages.some((m) => m.attachments.size > 0 || m.embeds.some((e) => e.image !== null || e.url !== null))
  }

  /**
   * Re-renders the bracket embed in the parent bracket channel.
   */
  public async updateBracketEmbed(
    parentChannelId: string,
    messageId: string,
    tournament: Tournament,
    matches: TournamentMatch[],
    players: TournamentPlayer[],
    playerNamesMap: Map<number, string>
  ): Promise<void> {
    const client = this.application.discordInstance.getClient()
    const channel = await client.channels.fetch(parentChannelId).catch(() => undefined)
    if (!channel || channel.type !== ChannelType.GuildText) return

    const textChannel = channel

    // Build the bracket description
    let description =
      `🏆 **Game:** ${tournament.gameType}\n` +
      `• **Best Of:** ${tournament.bestOf}\n` +
      `• **Status:** \`${tournament.status}\`\n` +
      `• **Total Rounds:** ${tournament.totalRounds}\n` +
      `• **Players:** ${players.length}\n` +
      `• **Created:** <t:${tournament.createdAt}:F>\n`

    if (tournament.startedAt !== undefined) {
      description += `• **Started:** <t:${tournament.startedAt}:R>\n`
    }
    if (tournament.completedAt !== undefined) {
      description += `• **Completed:** <t:${tournament.completedAt}:R>\n`
    }
    description += '\n'

    // Group matches by round
    const matchesByRound = new Map<number, TournamentMatch[]>()
    for (const match of matches) {
      const roundMatches = matchesByRound.get(match.round) ?? []
      roundMatches.push(match)
      matchesByRound.set(match.round, roundMatches)
    }

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Tournament: ${tournament.name}`)
      .setColor('#FFA500')
      .setDescription(description)

    // Add fields for each round
    for (let r = 1; r <= tournament.totalRounds; r++) {
      const roundMatches = matchesByRound.get(r) ?? []
      roundMatches.sort((a, b) => a.matchIndex - b.matchIndex)

      let roundContent = ''
      for (const match of roundMatches) {
        const p1Name =
          match.player1Id === undefined
            ? '⏳ Pending'
            : (playerNamesMap.get(match.player1Id) ?? `Player #${match.player1Id}`)
        const p2Name =
          match.player2Id === undefined
            ? '⏳ Pending'
            : (playerNamesMap.get(match.player2Id) ?? `Player #${match.player2Id}`)

        let statusEmoji = '⏳'
        let details = ''

        switch (match.status) {
          case MatchStatus.Completed: {
            statusEmoji = '✅'
            const winnerName =
              match.winnerId === undefined ? 'Unknown' : (playerNamesMap.get(match.winnerId) ?? 'Unknown')
            details = ` (Winner: **${winnerName}**)`
            break
          }
          case MatchStatus.Active: {
            statusEmoji = '🟢'
            if (match.discordThreadId !== undefined) {
              details = ` [<#${match.discordThreadId}>]`
            }
            break
          }
          case MatchStatus.Disputed: {
            statusEmoji = '🔴'
            details = ` **[DISPUTED]**`
            break
          }
          case MatchStatus.Reported: {
            statusEmoji = '🟡'
            details = ` *(Reported)*`
            break
          }
          case MatchStatus.Bye: {
            statusEmoji = '💤'
            const winnerName =
              match.winnerId === undefined ? 'Unknown' : (playerNamesMap.get(match.winnerId) ?? 'Unknown')
            details = ` (**BYE** → **${winnerName}**)`
            break
          }
        }

        roundContent += `${statusEmoji} Match ${match.matchIndex + 1}: ${p1Name} vs ${p2Name}${details}\n`
      }

      if (roundContent) {
        embed.addFields({
          name: `Round ${r}`,
          value: roundContent,
          inline: false
        })
      }
    }

    // Set winner if completed
    if (tournament.status === TournamentStatus.Completed && tournament.winnerId !== undefined) {
      const winnerName = playerNamesMap.get(tournament.winnerId) ?? 'Unknown'
      embed.addFields({
        name: '🏆 Winner',
        value: `Congratulations to **${winnerName}**! 🎉`,
        inline: false
      })
    }

    // Post or edit message
    try {
      const message = await textChannel.messages.fetch(messageId).catch(() => undefined)
      await (message === undefined ? textChannel.send({ embeds: [embed] }) : message.edit({ embeds: [embed] }))
    } catch {
      // ignore message edit/send errors
    }
  }
}
