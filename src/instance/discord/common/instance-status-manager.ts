import type { ButtonInteraction, MessageActionRowComponentData } from 'discord.js'
import { ButtonStyle, ComponentType, escapeMarkdown, MessageFlags } from 'discord.js'

import type Application from '../../../application'
import { Permission } from '../../../common/application-event'
import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler'
import { translateInstanceStatus } from '../../../core/instance/instance-language'
import { beautifyInstanceName } from '../../../utility/shared-utility'
import type DiscordInstance from '../discord-instance'
import { DefaultTimeout, interactivePaging } from '../utility/discord-pager'

import { translateNoPermission } from './discord-language'
import type MessageAssociation from './message-association'

export class InstanceStatusManager {
  private static readonly PermissionToView = Permission.Helper
  private static readonly EntriesPerPage = 5
  private static readonly DetailsButtonId = 'show-instance-details'

  constructor(
    private readonly application: Application,
    private readonly clientInstance: DiscordInstance,
    private readonly messageAssociation: MessageAssociation,
    private readonly errorHandler: UnexpectedErrorHandler
  ) {
    this.clientInstance.getClient().on('interactionCreate', (interaction) => {
      if (!interaction.isButton() || !interaction.isMessageComponent()) return

      switch (interaction.customId) {
        case InstanceStatusManager.DetailsButtonId: {
          void this.handleDetailsButton(interaction).catch(
            this.errorHandler.promiseCatch('handling "show details" button in an instance status message.')
          )
        }
      }
    })
  }

  public async handleDetailsButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const entry = this.application.core.discordInstanceHistoryButton.getButton(interaction.message.id)
    if (entry === undefined) {
      await interaction.editReply('Message too old to find the history??')
      return
    }

    const identifier = this.clientInstance.profileByUser(
      interaction.user,
      interaction.inCachedGuild() ? interaction.member : undefined
    )
    const user = await this.application.core.initializeDiscordUser(identifier, {
      guild: interaction.guild ?? undefined
    })

    const permission = await user.permission()
    if (permission < InstanceStatusManager.PermissionToView) {
      await interaction.editReply({
        content: translateNoPermission(this.application, InstanceStatusManager.PermissionToView),
        allowedMentions: { parse: [] }
      })
      return
    }

    await interactivePaging(interaction, 0, DefaultTimeout, this.errorHandler, async (requestedPage) => {
      const history = await this.application.core.statusHistory.getHistory(
        entry.instanceName,
        entry.startTime,
        entry.endTime
      )
      const entries = history.toReversed()

      const start = requestedPage * InstanceStatusManager.EntriesPerPage
      const end = Math.min((requestedPage + 1) * InstanceStatusManager.EntriesPerPage, entries.length)

      let result = ''
      for (let index = start; index < end; index++) {
        const element = entries[index]
        const t = this.application.getTranslatorForBridge(element.bridgeId)
        result += `${index + 1}. <t:${Math.floor(element.createdAt / 1000)}:S> `
        result += escapeMarkdown(translateInstanceStatus(t, { from: element.fromStatus, to: element.toStatus })) + '\n'
      }

      if (result.length === 0) {
        result = 'Nothing to show.'
      }

      return {
        embed: {
          title: `Status History for ${beautifyInstanceName(entry.instanceName)}`,
          description: result.trim()
        },
        totalPages: Math.ceil(entries.length / InstanceStatusManager.EntriesPerPage)
      }
    })
  }

  public async send(): Promise<void> {
    // Stub implementation for backwards compatibility
  }

  private generateButtons(): MessageActionRowComponentData[] {
    return [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        customId: InstanceStatusManager.DetailsButtonId,
        label: 'Show Details',
        emoji: { name: '📑' }
      }
    ]
  }
}
