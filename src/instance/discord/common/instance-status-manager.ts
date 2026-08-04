import type { ButtonInteraction, MessageActionRowComponentData } from 'discord.js'
import { ButtonStyle, ComponentType, escapeMarkdown, MessageFlags } from 'discord.js'

import type Application from '../../../application'
import { InstanceMessageType, Permission } from '../../../common/application-event'
import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler'
import {
  translateAuthenticationCodeExpired,
  translateInstanceMessage,
  translateInstanceStatus
} from '../../../core/instance/instance-language'
import { StatusHistoryEntryType } from '../../../core/instance/status-history'
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

      let firstAuthenticationIndex = -1
      let authenticationFound = false
      for (let index = 0; index < entries.length; index++) {
        const currentEntry = entries[index]

        const currentIsAuthentication =
          currentEntry.entryType === StatusHistoryEntryType.Message &&
          currentEntry.type === InstanceMessageType.MinecraftAuthenticationCode

        if (currentIsAuthentication) {
          if (firstAuthenticationIndex === -1) firstAuthenticationIndex = index

          if (authenticationFound) {
            entries.splice(index, 1)
            index--
          } else {
            authenticationFound = true
          }
        } else {
          authenticationFound = false
        }
      }

      const start = requestedPage * InstanceStatusManager.EntriesPerPage
      const end = Math.min((requestedPage + 1) * InstanceStatusManager.EntriesPerPage, entries.length)

      let result = ''
      for (let index = start; index < end; index++) {
        const element = entries[index]
        const t = this.application.getTranslatorForBridge(element.bridgeId)
        result += `${index + 1}. <t:${Math.floor(element.createdAt / 1000)}:S> `

        switch (element.entryType) {
          case StatusHistoryEntryType.Message: {
            result += escapeMarkdown(translateInstanceMessage(t, element.type)) + '\n'
            if (element.value !== undefined) {
              // eslint-disable-next-line unicorn/prefer-ternary
              if (
                element.type === InstanceMessageType.MinecraftAuthenticationCode &&
                index !== firstAuthenticationIndex
              ) {
                result += escapeMarkdown(translateAuthenticationCodeExpired(t)) + '\n'
              } else {
                result += escapeMarkdown(element.value.trim()) + '\n'
              }
            }

            break
          }
          case StatusHistoryEntryType.Status: {
            result +=
              escapeMarkdown(translateInstanceStatus(t, { from: element.fromStatus, to: element.toStatus })) + '\n'
            break
          }

          default: {
            throw new Error(`unknown type: ${JSON.stringify(element satisfies never)}`)
          }
        }
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
    // Intentionally empty: status is delivered interactively via interactivePaging.
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
