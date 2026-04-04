import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands'
import { Permission } from '../../../common/application-event'
import { RulesEvaluator } from '../../../core/rankup/rules-evaluator'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('rankup-check')
      .setDescription('Check rankup status for a player (Dry Run)')
      .addStringOption((option) =>
        option.setName('username').setDescription('The Minecraft username to check').setRequired(true)
      ),
  permission: Permission.Helper,
  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { application, interaction, bridgeId } = context

    await interaction.deferReply()

    if (!bridgeId) {
        await interaction.editReply('This command must be run in a bridge context.')
        return
    }

    const username = interaction.options.getString('username', true)
    
    // Check if we can get guild data.
    const uuid = await application.mojangApi.profileByUsername(username).then((p) => p.id).catch(() => null)
    if (!uuid) {
      await interaction.editReply('Invalid username.')
      return
    }
    
    const bridgeConfig = application.core.bridgeConfigurations
    
    const instances = bridgeConfig.getMinecraftInstances(bridgeId)
    if (instances.length === 0) {
      await interaction.editReply('No Minecraft instances configured for this bridge.')
      return
    }
    
    const botName = instances[0]
    const guild = await application.hypixelApi.getGuild('player', botName, {}).catch(() => null)
    
    if (!guild) {
      await interaction.editReply('Could not fetch guild data.')
      return
    }
    
    const member = guild.members.find((m) => m.uuid === uuid)
    if (!member) {
      await interaction.editReply('Player is not in the guild.')
      return
    }

    const promotionRules = bridgeConfig.getRankupRules(bridgeId)
    const demotionRules = bridgeConfig.getRankupDemotionRules(bridgeId)
    const excludedRanks = bridgeConfig.getRankupExcludedRanks(bridgeId)
    const excludedPlayers = bridgeConfig.getRankupExcludedPlayers(bridgeId)

    const rankPriority = guild.ranks
      ? guild.ranks.sort((a, b) => a.priority - b.priority).map((r) => r.name.toLowerCase())
      : []

    const expHistoryValues = Object.values(member.expHistory)
    const weeklyGexp = expHistoryValues.reduce((a, b) => a + (typeof b === 'number' ? b : (b as any).exp || 0), 0)

    const stats = {
      uuid: member.uuid,
      rank: member.rank,
      joinedAt: member.joinedAt.getTime(),
      weeklyGexp,
      lastOnline: 0
    }

    const evaluator = new RulesEvaluator()
    const result = evaluator.evaluate(
      stats,
      promotionRules,
      demotionRules,
      excludedRanks,
      excludedPlayers,
      rankPriority
    )

    const embed = new EmbedBuilder()
      .setTitle(`Rankup Check: ${username}`)
      .addFields(
        { name: 'Current Rank', value: member.rank, inline: true },
        { name: 'Weekly GEXP', value: stats.weeklyGexp.toLocaleString(), inline: true },
        { name: 'Days in Guild', value: ((Date.now() - stats.joinedAt) / (1000 * 60 * 60 * 24)).toFixed(1), inline: true },
        { name: 'Result', value: result.action === 'none' ? 'No Action' : result.action.toUpperCase() },
        { name: 'Target Rank', value: result.targetRank ?? 'N/A' },
        { name: 'Reason', value: result.reason ?? 'N/A' }
      )
      .setColor(result.action === 'none' ? '#808080' : result.action === 'promote' ? '#00FF00' : '#FF0000')

    await interaction.editReply({ embeds: [embed] })
  }
} satisfies DiscordCommandHandler
