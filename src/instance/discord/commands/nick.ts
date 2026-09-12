import { SlashCommandBuilder } from 'discord.js'

import { Permission } from '../../../common/application-event.js'
import type { DiscordCommandHandler } from '../../../common/commands.js'
import { formatRankPrefix, normalizePlayerRank, PLAYER_RANKS } from '../common/rank-format.js'

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{1,16}$/

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder()
      .setName('nick')
      .setDescription('Set a custom name for rendered chat images / Discord messages')
      .addStringOption((option) =>
        option
          .setName('name')
          .setDescription('Custom Minecraft username. Leave empty to clear.')
          .setRequired(false)
          .setMaxLength(16)
      )
      .addStringOption((option) =>
        option
          .setName('player')
          .setDescription('Minecraft player whose name to override. Leave empty for the bot itself.')
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('rank')
          .setDescription('Hypixel rank to spoof. Use "none" to clear.')
          .setRequired(false)
          .setAutocomplete(true)
      ),

  permission: Permission.Helper,

  handler: async function (context) {
    const interaction = context.interaction
    if (context.bridgeId === undefined) {
      await interaction.reply({ content: 'This command must be used in a configured bridge channel.', ephemeral: true })
      return
    }
    const bridgeId = context.bridgeId

    const customName = interaction.options.getString('name')
    const targetPlayer = interaction.options.getString('player')
    const rankOption = interaction.options.getString('rank')
    const bridgeConfigurations = context.application.core.bridgeConfigurations

    if (targetPlayer !== null && targetPlayer.trim().length > 0) {
      const targetPlayerName = targetPlayer.trim()
      if (!USERNAME_PATTERN.test(targetPlayerName)) {
        await interaction.reply({
          content: 'Invalid player name. Must be 1-16 characters: letters, numbers, or underscores.',
          ephemeral: true
        })
        return
      }

      const responseMessages: string[] = []

      if (customName !== null) {
        if (customName.trim().length === 0) {
          const existingUsernameOverride = bridgeConfigurations.getPlayerUsernameOverride(bridgeId, targetPlayerName)
          if (existingUsernameOverride === undefined) {
            responseMessages.push(
              `No custom name is set for \`${targetPlayerName}\`. They use their real Minecraft username.`
            )
          } else {
            bridgeConfigurations.setPlayerUsernameOverride(bridgeId, targetPlayerName, undefined)
            responseMessages.push(
              `Cleared custom name for \`${targetPlayerName}\`. They now use their real Minecraft username.`
            )
          }
        } else {
          const trimmedCustomName = customName.trim()
          if (!USERNAME_PATTERN.test(trimmedCustomName)) {
            await interaction.reply({ content: 'Invalid name. Must be 1-16 characters.', ephemeral: true })
            return
          }
          bridgeConfigurations.setPlayerUsernameOverride(bridgeId, targetPlayerName, trimmedCustomName)
          responseMessages.push(
            `Set custom name for \`${targetPlayerName}\` to \`${trimmedCustomName}\`. Their messages will show as \`${trimmedCustomName}\` in Discord.`
          )
        }
      }

      if (rankOption !== null) {
        const normalizedRank = normalizePlayerRank(rankOption)
        if (rankOption.trim().length > 0 && normalizedRank === undefined) {
          await interaction.reply({
            content: `Invalid rank. Must be one of: ${PLAYER_RANKS.join(', ')}, or "none" to clear.`,
            ephemeral: true
          })
          return
        }
        if (normalizedRank === undefined || normalizedRank === 'Default') {
          const existingRankOverride = bridgeConfigurations.getPlayerRankOverride(bridgeId, targetPlayerName)
          if (existingRankOverride === undefined) {
            responseMessages.push(
              `No custom rank is set for \`${targetPlayerName}\`. They use their real Hypixel rank.`
            )
          } else {
            bridgeConfigurations.setPlayerRankOverride(bridgeId, targetPlayerName, undefined)
            responseMessages.push(
              `Cleared custom rank for \`${targetPlayerName}\`. They now use their real Hypixel rank.`
            )
          }
        } else {
          bridgeConfigurations.setPlayerRankOverride(bridgeId, targetPlayerName, normalizedRank)
          const displayRank = formatRankPrefix(normalizedRank) || normalizedRank
          responseMessages.push(`Set custom rank for \`${targetPlayerName}\` to \`${displayRank}\`.`)
        }
      }

      if (responseMessages.length === 0) {
        const currentUsername = bridgeConfigurations.getPlayerUsernameOverride(bridgeId, targetPlayerName)
        const currentRank = bridgeConfigurations.getPlayerRankOverride(bridgeId, targetPlayerName)
        const usernameDisplay: string = currentUsername === undefined ? 'real username' : `\`${currentUsername}\``
        const rankDisplay: string =
          currentRank === undefined ? 'real rank' : `\`${formatRankPrefix(currentRank) || currentRank}\``
        await interaction.reply({
          content: `Current nicks for \`${targetPlayerName}\`: name = ${usernameDisplay}, rank = ${rankDisplay}. Provide \`name\` and/or \`rank\` to change.`,
          ephemeral: true
        })
        return
      }
      await interaction.reply({ content: responseMessages.join('\n'), ephemeral: true })
      return
    }

    const responseMessages: string[] = []

    if (customName !== null) {
      if (customName.trim().length === 0) {
        const currentBotUsername = bridgeConfigurations.getBotUsernameOverride(bridgeId)
        if (currentBotUsername === undefined) {
          responseMessages.push('No custom nick is set. The bot uses its real Minecraft username.')
        } else {
          bridgeConfigurations.setBotUsernameOverride(bridgeId, undefined)
          responseMessages.push('Cleared custom nick. The bot now uses its real Minecraft username.')
        }
      } else {
        const trimmedCustomName = customName.trim()
        if (!USERNAME_PATTERN.test(trimmedCustomName)) {
          await interaction.reply({ content: 'Invalid name. Must be 1-16 characters.', ephemeral: true })
          return
        }
        const minecraftBots = context.application.minecraftManager.getMinecraftBots()
        const bridgeBot = minecraftBots.find((bot) =>
          context.application.bridgeResolver.shouldProcessEvent(bridgeId, bot.instanceName)
        )
        const realUsername: string = bridgeBot?.username ?? 'unknown'
        bridgeConfigurations.setBotUsernameOverride(bridgeId, trimmedCustomName)
        responseMessages.push(
          `Set custom nick to \`${trimmedCustomName}\`. Rendered chat images will show \`${trimmedCustomName}\` instead of \`${realUsername}\`.`
        )
      }
    }

    if (rankOption !== null) {
      const normalizedRank = normalizePlayerRank(rankOption)
      if (rankOption.trim().length > 0 && normalizedRank === undefined) {
        await interaction.reply({
          content: `Invalid rank. Must be one of: ${PLAYER_RANKS.join(', ')}, or "none" to clear.`,
          ephemeral: true
        })
        return
      }
      if (normalizedRank === undefined || normalizedRank === 'Default') {
        const existingBotRank = bridgeConfigurations.getBotRankOverride(bridgeId)
        if (existingBotRank === undefined) {
          responseMessages.push('No custom rank is set. The bot uses its real Hypixel rank.')
        } else {
          bridgeConfigurations.setBotRankOverride(bridgeId, undefined)
          responseMessages.push('Cleared custom rank. The bot now uses its real Hypixel rank.')
        }
      } else {
        bridgeConfigurations.setBotRankOverride(bridgeId, normalizedRank)
        const displayRank = formatRankPrefix(normalizedRank) || normalizedRank
        responseMessages.push(`Set custom rank to \`${displayRank}\`.`)
      }
    }

    if (responseMessages.length === 0) {
      const currentBotUsername = bridgeConfigurations.getBotUsernameOverride(bridgeId)
      const currentBotRank = bridgeConfigurations.getBotRankOverride(bridgeId)
      const usernameDisplay: string = currentBotUsername === undefined ? 'real username' : `\`${currentBotUsername}\``
      const rankDisplay: string =
        currentBotRank === undefined ? 'real rank' : `\`${formatRankPrefix(currentBotRank) || currentBotRank}\``
      await interaction.reply({
        content: `Current bot nicks: name = ${usernameDisplay}, rank = ${rankDisplay}. Provide \`name\` and/or \`rank\` to change.`,
        ephemeral: true
      })
      return
    }
    await interaction.reply({ content: responseMessages.join('\n'), ephemeral: true })
  },

  autoComplete: async function (context) {
    const focusedOption = context.interaction.options.getFocused(true)
    if (focusedOption.name === 'player') {
      const usernameChoices: string[] = await context.application.core.completeUsername(
        focusedOption.value,
        25,
        context.bridgeId
      )
      await context.interaction.respond(usernameChoices.map((username) => ({ name: username, value: username })))
    } else if (focusedOption.name === 'rank') {
      const query = focusedOption.value.toLowerCase()
      const availableRanks: string[] = [...(PLAYER_RANKS as readonly string[]), 'none']
      const matchingRanks: string[] =
        query.length === 0
          ? availableRanks
          : availableRanks.filter((rankName) => rankName.toLowerCase().includes(query))
      await context.interaction.respond(matchingRanks.slice(0, 25).map((choice) => ({ name: choice, value: choice })))
    }
  }
} satisfies DiscordCommandHandler
