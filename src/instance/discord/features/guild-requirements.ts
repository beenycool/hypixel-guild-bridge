import type { ButtonInteraction, Client, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js'
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, escapeMarkdown, MessageFlags } from 'discord.js'

import type { GuildRequirementsConfig } from '../../../application-config.js'
import type { GuildPlayerEvent, InstanceType } from '../../../common/application-event.js'
import { GuildPlayerEventType, MinecraftSendChatPriority, Permission } from '../../../common/application-event.js'
import SubInstance from '../../../common/sub-instance'
import { checkChatTriggers, InviteAcceptChat } from '../../../utility/chat-triggers.js'
import { getFirstConnectedBridgeMinecraftInstanceName } from '../common/bridge-minecraft-instances.js'
import { formatChatTriggerResponse } from '../common/chattrigger-format.js'
import {
  checkGuildRequirements,
  createGuildRequirementsEmbed,
  type GuildRequirementsCheck
} from '../common/guild-requirements.js'
import type DiscordInstance from '../discord-instance.js'

interface AcceptRequestPayload {
  instanceName: string
  username: string
}

export default class GuildRequirements extends SubInstance<DiscordInstance, InstanceType.Discord, Client> {
  private static readonly AcceptButtonPrefix = 'guild-req-accept'

  constructor(clientInstance: DiscordInstance) {
    super(clientInstance)

    this.application.on('guildPlayer', (event) => {
      if (event.type !== GuildPlayerEventType.Request) return
      void this.handleJoinRequest(event).catch(this.errorHandler.promiseCatch('handling guild join request'))
    })

    const client = this.clientInstance.getClient()
    client.on('interactionCreate', (interaction) => {
      if (!interaction.isButton() || !interaction.isMessageComponent()) return

      if (interaction.customId.startsWith('join-request:')) {
        void this.handleJoinRequestButton(interaction).catch(
          this.errorHandler.promiseCatch('handling join request button interaction')
        )
        return
      }

      const payload = this.parseAcceptButton(interaction.customId)
      if (!payload) return

      void this.handleAcceptButton(interaction, payload).catch(
        this.errorHandler.promiseCatch('handling guild join request accept button')
      )
    })
  }

  private parseAcceptButton(customId: string): AcceptRequestPayload | undefined {
    if (!customId.startsWith(`${GuildRequirements.AcceptButtonPrefix}:`)) return undefined

    const parts = customId.split(':')
    if (parts.length < 3) return undefined

    const instanceName = parts[1]
    const username = parts.slice(2).join(':')
    if (!instanceName || !username) return undefined

    return { instanceName, username }
  }

  private async handleJoinRequest(event: GuildPlayerEvent): Promise<void> {
    const config = this.application.config.guildRequirements
    if (!config?.enabled) return

    const mojangProfile = event.user.mojangProfile() as ReturnType<typeof event.user.mojangProfile> | undefined
    if (mojangProfile == undefined) return

    const requirements = config.requirements
    const result = await checkGuildRequirements(this.application, mojangProfile.id, requirements, mojangProfile.name)
    if (!result) {
      this.logger.warn(`Failed to fetch guild requirements data for ${mojangProfile.name}`)
      return
    }

    await this.sendOfficerSummary(event.instanceName, result).catch(
      this.errorHandler.promiseCatch('sending guild requirements officer summary')
    )
    await this.notifyDiscord(event, mojangProfile.name, result, config).catch(
      this.errorHandler.promiseCatch('sending guild requirements discord notification')
    )

    if (config.autoAccept && result.meetsRequirements) {
      await this.sendAcceptCommand(event.instanceName, mojangProfile.name).catch(
        this.errorHandler.promiseCatch('auto-accepting guild request')
      )
    }
  }

  private async notifyDiscord(
    event: GuildPlayerEvent,
    username: string,
    result: GuildRequirementsCheck,
    config: GuildRequirementsConfig
  ): Promise<void> {
    const client = this.clientInstance.getClient()
    if (!client.isReady()) return

    const channelIds = this.application.core.discordConfigurations.getLoggerChannelIds()
    if (channelIds.length === 0) {
      this.logger.warn('Guild requirements enabled but no logger channels are configured.')
      return
    }

    const descriptionParts = [`Requested on ${event.instanceName}.`]
    if (config.autoAccept && result.meetsRequirements) {
      descriptionParts.push('Auto-accept triggered.')
    }

    const embed = createGuildRequirementsEmbed(
      { ...result, requirements: config.requirements },
      { titlePrefix: 'Join request:', description: descriptionParts.join(' ') }
    )

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(this.buildAcceptButtonId(event.instanceName, username))
        .setLabel('Accept Request')
        .setStyle(ButtonStyle.Success)
    )

    for (const channelId of channelIds) {
      try {
        const channel = await client.channels.fetch(channelId)
        if (!channel?.isSendable()) continue
        await channel.send({ embeds: [embed], components: [actionRow], allowedMentions: { parse: [] } })
      } catch (error: unknown) {
        this.logger.error(`Failed to send guild request notification to ${channelId}`, error)
      }
    }
  }

  private async handleAcceptButton(interaction: ButtonInteraction, payload: AcceptRequestPayload): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'This action can only be used in a server.' })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    if (!(await this.ensurePermission(interaction))) {
      await interaction.editReply('You do not have permission to accept guild requests.')
      return
    }

    const command = `/g accept ${payload.username}`

    try {
      const result = await checkChatTriggers(
        this.application,
        this.eventHelper,
        InviteAcceptChat,
        [payload.instanceName],
        command,
        payload.username
      )
      const formatted = formatChatTriggerResponse(result, `Accept ${escapeMarkdown(payload.username)}`)
      await interaction.editReply({ embeds: [formatted] })
    } catch (error: unknown) {
      this.logger.error('Failed to accept guild request', error)
      await interaction.editReply('Failed to accept the request. Check logs for details.')
    }
  }

  private async ensurePermission(interaction: ButtonInteraction): Promise<boolean> {
    const permission = await this.clientInstance.resolvePermission(interaction.user.id)
    return permission >= Permission.Helper
  }

  private buildAcceptButtonId(instanceName: string, username: string): string {
    return `${GuildRequirements.AcceptButtonPrefix}:${instanceName}:${username}`
  }

  private async sendAcceptCommand(instanceName: string, username: string): Promise<void> {
    await this.application.sendMinecraft(
      [instanceName],
      MinecraftSendChatPriority.High,
      undefined,
      `/g accept ${username}`
    )
  }

  private async sendOfficerSummary(instanceName: string, result: GuildRequirementsCheck): Promise<void> {
    const summary = this.formatOfficerSummary(result)
    await this.application.sendMinecraft([instanceName], MinecraftSendChatPriority.Default, undefined, `/oc ${summary}`)
  }

  private async handleJoinRequestButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'This action can only be used in a server.', flags: MessageFlags.Ephemeral })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    if (!(await this.ensurePermission(interaction))) {
      await interaction.editReply('You do not have permission to manage guild join requests.')
      return
    }

    const parts = interaction.customId.split(':')
    if (parts.length < 4) {
      await interaction.editReply('Invalid button action.')
      return
    }

    const action = parts[1]
    const instanceName = parts[2]
    const username = parts.slice(3).join(':')

    const disabledRows = interaction.message.components.map((row) => {
      const builder = new ActionRowBuilder<ButtonBuilder>()
      if ('components' in row && Array.isArray(row.components)) {
        for (const component of row.components) {
          if (component.type === ComponentType.Button) {
            builder.addComponents(ButtonBuilder.from(component).setDisabled(true))
          }
        }
      }
      return builder
    })
    await interaction.message
      .edit({ components: disabledRows })
      .catch(() => undefined)

    if (action === 'accept') {
      const command = `/g accept ${username}`
      try {
        const result = await checkChatTriggers(
          this.application,
          this.eventHelper,
          InviteAcceptChat,
          [instanceName],
          command,
          username
        )
        const formatted = formatChatTriggerResponse(result, `Accept ${escapeMarkdown(username)}`)
        await interaction.editReply({ embeds: [formatted] })
        if (interaction.channel?.isSendable()) {
          await interaction.channel.send({
            content: `✅ **Accepted** join request for **${escapeMarkdown(username)}** (by <@${interaction.user.id}>).`,
            allowedMentions: { parse: [] }
          })
        }
      } catch (error: unknown) {
        this.logger.error('Failed to accept guild request', error)
        await interaction.editReply('Failed to accept the request. Check logs for details.')
      }
    } else if (action === 'deny') {
      await interaction.editReply({ content: `Denied join request for ${escapeMarkdown(username)}.` })
      if (interaction.channel?.isSendable()) {
        await interaction.channel.send({
          content: `❌ **Denied** join request for **${escapeMarkdown(username)}** (by <@${interaction.user.id}>).`,
          allowedMentions: { parse: [] }
        })
      }
    }
  }

  private formatOfficerSummary(result: GuildRequirementsCheck): string {
    const stats = result.stats
    const status = result.meetsRequirements ? 'meets' : "doesn't meet"

    return (
      `${result.displayName} ${status} requirements. ` +
      `[BW ${formatInteger(stats.bedwarsStars)} FKDR: ${formatDecimal(stats.bedwarsFKDR)}] ` +
      `[SW ${formatInteger(stats.skywarsStars)} KDR: ${formatDecimal(stats.skywarsKDR)}] ` +
      `[Duels Wins: ${formatInteger(stats.duelsWins)} WLR: ${formatDecimal(stats.duelsWLR)}] ` +
      `SB Level: ${formatDecimal(stats.skyblockLevel)}`
    )
  }
}

function formatInteger(value: number): string {
  return Math.floor(value).toLocaleString()
}

function formatDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}
