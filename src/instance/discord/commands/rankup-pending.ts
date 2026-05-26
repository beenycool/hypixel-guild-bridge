import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js'

import { MinecraftSendChatPriority, Permission } from '../../../common/application-event'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands'

const REVIEWS_PER_PAGE = 25

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

    let reviews = pendingManager.getReviews(bridgeId)

    if (reviews.length === 0) {
      await interaction.editReply('No pending reviews.')
      return
    }

    let currentPage = 0
    const uuidToName = new Map<string, string>()

    const generatePage = async (page: number) => {
      const start = page * REVIEWS_PER_PAGE
      const displayedReviews = reviews.slice(start, start + REVIEWS_PER_PAGE)
      const totalPages = Math.ceil(reviews.length / REVIEWS_PER_PAGE)

      // Resolve names for currently displayed reviews
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
              .setDescription(r.reason.slice(0, 100))
              .setValue(r.id.toString())
          )
        )

      const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)
      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('rankup-prev')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('rankup-next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)
      )

      const embed = new EmbedBuilder()
        .setTitle('Pending Rankup Reviews')
        .setDescription(
          `Found ${reviews.length} pending reviews. Showing ${start + 1}-${start + displayedReviews.length} (Page ${
            page + 1
          }/${totalPages}).`
        )
        .setColor('#FFA500')

      return { embeds: [embed], components: totalPages > 1 ? [menuRow, buttonRow] : [menuRow] }
    }

    const initialPage = await generatePage(currentPage)
    const response = await interaction.editReply(initialPage)

    const collector = response.createMessageComponentCollector({
      time: 600_000, // 10 mins
      filter: (index) => index.user.id === interaction.user.id
    })

    collector.on('collect', async (index) => {
      switch (index.customId) {
        case 'rankup-prev': {
          currentPage--
          await index.update(await generatePage(currentPage))

          break
        }
        case 'rankup-next': {
          currentPage++
          await index.update(await generatePage(currentPage))

          break
        }
        case 'rankup-select-review': {
          if (!index.isStringSelectMenu()) return
          const reviewId = Number.parseInt(index.values[0])
          const review = pendingManager.getReview(reviewId)

          if (!review) {
            await index.reply({ content: 'Review no longer exists.', flags: 64 }) // Ephemeral
            return
          }

          const name = uuidToName.get(review.uuid) ?? review.uuid

          const detailEmbed = new EmbedBuilder()
            .setTitle(`Review for ${name}`)
            .addFields(
              { name: 'Action', value: review.action.toUpperCase(), inline: true },
              { name: 'Current Rank', value: review.currentRank, inline: true },
              { name: 'Proposed Rank', value: review.proposedRank, inline: true },
              { name: 'Reason', value: review.reason },
              { name: 'Created At', value: `<t:${review.createdAt}:R>` }
            )

          const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`approve-${reviewId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject-${reviewId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
          )

          const message = await index.reply({
            embeds: [detailEmbed],
            components: [actionRow],
            fetchReply: true
          })

          const buttonCollector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60_000,
            filter: (button) => button.user.id === interaction.user.id
          })

          buttonCollector.on('collect', async (button) => {
            const action = button.customId.startsWith('approve') ? 'approve' : 'reject'

            if (action === 'reject') {
              pendingManager.removeReview(reviewId)
              pendingManager.logHistory(
                bridgeId,
                review.uuid,
                'reject',
                review.currentRank,
                review.proposedRank,
                button.user.tag
              )
              await button.update({ content: 'Review rejected.', embeds: [], components: [] })
            } else {
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
                      await button.update({
                        content: 'Error: pending review is missing a target rank.',
                        components: []
                      })
                      return
                    }
                    command = `/g setrank ${name} ${review.proposedRank}`
                  } else if (review.action === 'kick') {
                    command = `/g kick ${name} ${review.reason}`
                  }

                  await instance.send(command, MinecraftSendChatPriority.High, undefined)

                  pendingManager.removeReview(reviewId)
                  pendingManager.logHistory(
                    bridgeId,
                    review.uuid,
                    review.action,
                    review.currentRank,
                    review.proposedRank,
                    button.user.tag
                  )

                  await button.update({ content: `Action executed: ${command}`, embeds: [], components: [] })
                } else {
                  await button.update({ content: 'Error: Minecraft instance not found.', components: [] })
                }
              } else {
                await button.update({ content: 'Error: No Minecraft instances configured.', components: [] })
              }
            }
            buttonCollector.stop()

            // Refresh the main list
            reviews = pendingManager.getReviews(bridgeId)
            if (reviews.length === 0) {
              await interaction.editReply({ content: 'No pending reviews.', embeds: [], components: [] })
              collector.stop()
            } else {
              const totalPages = Math.ceil(reviews.length / REVIEWS_PER_PAGE)
              if (currentPage >= totalPages) currentPage = totalPages - 1
              await interaction.editReply(await generatePage(currentPage))
            }
          })

          break
        }
        // No default
      }
    })
  }
} satisfies DiscordCommandHandler
