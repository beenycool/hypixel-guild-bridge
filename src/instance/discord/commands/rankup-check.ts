import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands'
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

    const uuid = await application.mojangApi
      .profileByUsername(username)
      .then((p) => p.id)
      .catch(() => undefined)
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
    const guild = await application.hypixelApi.getGuild('player', botName, {}).catch(() => undefined)

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

    const rankPriority = guild.ranks.toSorted((a, b) => a.priority - b.priority).map((r) => r.name.toLowerCase())

    const weeklyGexp = member.weeklyExperience ?? 0

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

    let actionText: string
    let targetText: string
    let color: number

    switch (result.action) {
      case 'none': {
        actionText = 'No Action'
        targetText = 'N/A'
        color = 0x80_80_80
        break
      }
      case 'promote': {
        actionText = 'PROMOTE'
        targetText = result.targetRank
        color = 0x00_ff_00
        break
      }
      case 'demote': {
        actionText = 'DEMOTE'
        targetText = result.targetRank
        color = 0xff_00_00
        break
      }
      case 'kick': {
        actionText = 'KICK'
        targetText = 'Kick'
        color = 0xff_00_00
        break
      }
      case 'notify': {
        actionText = 'NOTIFY'
        targetText = 'N/A'
        color = 0xff_a5_00
        break
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`Rankup Check: ${username}`)
      .addFields(
        { name: 'Current Rank', value: member.rank, inline: true },
        { name: 'Weekly GEXP', value: stats.weeklyGexp.toLocaleString(), inline: true },
        {
          name: 'Days in Guild',
          value: ((Date.now() - stats.joinedAt) / (1000 * 60 * 60 * 24)).toFixed(1),
          inline: true
        },
        { name: 'Result', value: actionText },
        { name: 'Target Rank', value: targetText },
        { name: 'Reason', value: result.action === 'none' ? 'N/A' : result.reason }
      )
      .setColor(color)

    await interaction.editReply({ embeds: [embed] })
  }
} satisfies DiscordCommandHandler
