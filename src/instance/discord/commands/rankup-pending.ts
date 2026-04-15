import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType
} from 'discord.js'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands'
import { MinecraftSendChatPriority, Permission } from '../../../common/application-event'

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('rankup-pending').setDescription('View and manage pending rankup reviews'),
  permission: Permission.Officer,
  handler: async function (context: Readonly<DiscordCommandContext>) {
    const { application, interaction, bridgeId } = context

    await interaction.deferReply()

    if (!bridgeId) {
      await interaction.editReply('This command must be run in a bridge context.')
      return
    }

    const pendingManager = application.core.pendingReviewManager
    const bridgeConfig = application.core.bridgeConfigurations

    // We need to resolve names for UUIDs to make the list readable
    const reviews = pendingManager.getReviews(bridgeId)

    if (reviews.length === 0) {
      await interaction.editReply('No pending reviews.')
      return
    }

    // Limit to 25 for select menu
    const displayedReviews = reviews.slice(0, 25)

    // Resolve names
    const uuidToName = new Map<string, string>()
    for (const r of displayedReviews) {
      if (!uuidToName.has(r.uuid)) {
        const name = await application.mojangApi
          .profileByUuid(r.uuid)
          .then((p) => p.name)
          .catch(() => r.uuid.slice(0, 8))
        uuidToName.set(r.uuid, name)
      }
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('rankup-select-review')
      .setPlaceholder('Select a review to action')
      .addOptions(
        displayedReviews.map((r) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${uuidToName.get(r.uuid)}: ${r.action.toUpperCase()} ${r.currentRank} -> ${r.proposedRank}`)
            .setDescription(r.reason.substring(0, 100))
            .setValue(r.id.toString())
        )
      )

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)

    const embed = new EmbedBuilder()
      .setTitle('Pending Rankup Reviews')
      .setDescription(`Found ${reviews.length} pending reviews. Showing first ${displayedReviews.length}.`)
      .setColor('#FFA500')

    const response = await interaction.editReply({
      embeds: [embed],
      components: [row]
    })

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 600000, // 10 mins
      filter: (i) => i.user.id === interaction.user.id
    })

    collector.on('collect', async (i) => {
      if (i.customId === 'rankup-select-review') {
        const reviewId = parseInt(i.values[0])
        const review = pendingManager.getReview(reviewId)

        if (!review) {
          await i.reply({ content: 'Review no longer exists.', flags: 64 }) // Ephemeral
          return
        }

        const name = await application.mojangApi
          .profileByUuid(review.uuid)
          .then((p) => p.name)
          .catch(() => review.uuid)

        const detailEmbed = new EmbedBuilder()
          .setTitle(`Review for ${name}`)
          .addFields(
            { name: 'Action', value: review.action.toUpperCase(), inline: true },
            { name: 'Current Rank', value: review.currentRank, inline: true },
            { name: 'Proposed Rank', value: review.proposedRank, inline: true },
            { name: 'Reason', value: review.reason },
            { name: 'Created At', value: `<t:${review.createdAt}:R>` }
          )

        const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`approve-${reviewId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`reject-${reviewId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
        )

        const msg = await i.reply({
          embeds: [detailEmbed],
          components: [btnRow],
          fetchReply: true
        })

        const btnCollector = msg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000,
          filter: (btn) => btn.user.id === interaction.user.id
        })

        btnCollector.on('collect', async (btn) => {
          const action = btn.customId.startsWith('approve') ? 'approve' : 'reject'

          if (action === 'reject') {
            pendingManager.removeReview(reviewId)
            pendingManager.logHistory(
              bridgeId,
              review.uuid,
              'reject',
              review.currentRank,
              review.proposedRank,
              btn.user.tag
            )
            await btn.update({ content: 'Review rejected.', embeds: [], components: [] })
          } else {
            // Execute Action
            // We need to send command to Minecraft
            const instances = bridgeConfig.getMinecraftInstances(bridgeId)
            if (instances.length > 0) {
              const instanceName = instances[0]
              const instance = application.minecraftManager
                .getAllInstances()
                .find((inst) => inst.instanceName.toLowerCase() === instanceName.toLowerCase())
              if (instance) {
                let command = ''
                if (review.action === 'promote' || review.action === 'demote') {
                  if (review.proposedRank.length === 0) {
                    await btn.update({ content: 'Error: pending review is missing a target rank.', components: [] })
                    return
                  }

                  command = `/g setrank ${name} ${review.proposedRank}`
                } else if (review.action === 'kick') {
                  command = `/g kick ${name} ${review.reason}`
                }

                instance.send(command, MinecraftSendChatPriority.High, undefined)

                pendingManager.removeReview(reviewId)
                pendingManager.logHistory(
                  bridgeId,
                  review.uuid,
                  review.action as any,
                  review.currentRank,
                  review.proposedRank,
                  btn.user.tag
                )

                await btn.update({ content: `Action executed: ${command}`, embeds: [], components: [] })
              } else {
                await btn.update({ content: 'Error: Minecraft instance not found.', components: [] })
              }
            } else {
              await btn.update({ content: 'Error: No Minecraft instances configured.', components: [] })
            }
          }
          btnCollector.stop()
        })
      }
    })
  }
} satisfies DiscordCommandHandler
