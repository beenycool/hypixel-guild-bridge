import type { ButtonInteraction, Client } from 'discord.js'
import { MessageFlags } from 'discord.js'

import type { InstanceType } from '../../../common/application-event.js'
import SubInstance from '../../../common/sub-instance.js'
import { TournamentStatus } from '../../../core/tournament/types.js'
import type DiscordInstance from '../discord-instance.js'

export default class TournamentSignup extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  private static readonly Prefix = 'tournament-signup'

  constructor(clientInstance: DiscordInstance) {
    super(clientInstance)

    const client = this.clientInstance.getClient()
    client.on('interactionCreate', (interaction) => {
      if (!interaction.isButton()) return
      if (!interaction.customId.startsWith(`${TournamentSignup.Prefix}:`)) return
      void this.handleButton(interaction).catch(this.errorHandler.promiseCatch('handling tournament signup button'))
    })
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const parts = interaction.customId.split(':')
    if (parts.length !== 4) {
      await interaction.editReply('This signup button is no longer valid.')
      return
    }

    const [, bridgeId, action, tournamentIdRaw] = parts
    const tournamentId = Number(tournamentIdRaw)
    if (!Number.isInteger(tournamentId)) {
      await interaction.editReply('This signup button is no longer valid.')
      return
    }

    try {
      const { bridgeConfigurations, tournamentManager } = this.application.core

      if (!bridgeConfigurations.getTournamentEnabled(bridgeId)) {
        await interaction.editReply('Tournaments are not enabled on this bridge.')
        return
      }

      const tournament = await tournamentManager.getTournament(tournamentId)
      if (tournament?.bridgeId !== bridgeId) {
        await interaction.editReply('This tournament no longer exists.')
        return
      }
      if (tournament.status !== TournamentStatus.Signup) {
        await interaction.editReply('Sign-ups are closed for this tournament.')
        return
      }

      const link = await this.application.core.verification.findByDiscord(interaction.user.id)

      if (action === 'join') {
        if (link === undefined) {
          const abuseCheck = tournamentManager.antiAbuse.checkSignupRate(interaction.user.id)
          if (abuseCheck.allowed) {
            await this.notifyStaffForUnlinkedUser(
              bridgeId,
              interaction,
              `<@${interaction.user.id}> tried to join the tournament via the signup button, but their Minecraft account could not be resolved to a Discord link. Please help them get verified.`
            )
            await interaction.editReply(
              'You must link your Minecraft account first. Staff have been notified to help you verify.'
            )
          } else {
            await interaction.editReply(
              'You must link your Minecraft account first. Use `/verify` or contact an officer.'
            )
          }
          return
        }

        this.application.logger.info(
          `Tournament signup button join: tournament=${tournament.id}, user=${interaction.user.id}`
        )
        await tournamentManager.addPlayer(tournament.id, link.uuid, interaction.user.id)

        const profile = await this.application.mojangApi.profileByUuid(link.uuid)
        await interaction.editReply(`✅ You have joined **${tournament.name}** as **${profile.name}**!`)
        return
      }

      if (action === 'leave') {
        if (link === undefined) {
          await interaction.editReply('You are not registered in this tournament.')
          return
        }

        this.application.logger.info(
          `Tournament signup button leave: tournament=${tournament.id}, user=${interaction.user.id}`
        )
        await tournamentManager.removePlayer(tournament.id, link.uuid)
        await interaction.editReply(`✅ You have left **${tournament.name}**.`)
        return
      }

      await interaction.editReply('Unknown signup button action.')
    } catch (error: unknown) {
      await interaction.editReply(error instanceof Error ? error.message : String(error))
    }
  }

  private async notifyStaffForUnlinkedUser(
    bridgeId: string,
    interaction: ButtonInteraction,
    description: string
  ): Promise<void> {
    try {
      const { bridgeConfigurations, discordConfigurations } = this.application.core
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
      const client = this.clientInstance.getClient()
      const notificationChannel = notificationChannelId
        ? await client.channels.fetch(notificationChannelId).catch(() => undefined)
        : undefined
      const target = notificationChannel?.isSendable()
        ? notificationChannel
        : interaction.channel?.isSendable()
          ? interaction.channel
          : undefined

      if (target === undefined) {
        this.application.logger.warn(
          `Cannot notify staff for unlinked user: no sendable channel available (bridgeId=${bridgeId})`
        )
        return
      }

      const pingContent = uniqueRoleIds.map((id) => `<@&${id}>`).join(' ')
      await target.send({
        content: `${pingContent.length > 0 ? `${pingContent} ` : ''}${description}`,
        allowedMentions: { parse: [], roles: uniqueRoleIds }
      })
      this.application.logger.info(`Notified staff about unlinked user (bridgeId=${bridgeId})`)
    } catch (error: unknown) {
      this.application.logger.warn('Failed to notify staff about unlinked user', error)
    }
  }
}
