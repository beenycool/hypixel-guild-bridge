import assert from 'node:assert'

import type { APIEmbed, APIEmbedField, ButtonInteraction, InteractionResponse, Message } from 'discord.js'
import {
  ButtonStyle,
  ComponentType,
  escapeMarkdown,
  italic,
  MessageFlags,
  SlashCommandBuilder,
  TextInputStyle
} from 'discord.js'

import type Application from '../../../application.js'
import { Color, InstanceMessageType, InstanceType, Permission } from '../../../common/application-event.js'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands.js'
import { Status } from '../../../common/connectable-instance.js'
import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler.js'
import { ApplicationLanguages } from '../../../core/language-configurations'
import type { ProxyConfig } from '../../../core/minecraft/sessions-manager'
import { ProxyProtocol } from '../../../core/minecraft/sessions-manager'
import { SpontaneousEventsNames } from '../../../core/spontanmous-events-configurations'
import { debugSessionLog } from '../../../utility/debug-session-log.js'
import Duration from '../../../utility/duration'
import { SkyblockEventKeys } from '../../../utility/skyblock-calendar'
import { Timeout } from '../../../utility/timeout.js'
import { DefaultCommandFooter } from '../common/discord-config.js'
import type {
  ActionInteractionHelpers,
  ActionOption,
  BooleanOption,
  CategoryOption,
  EmbedCategoryOption,
  LabelOption,
  OptionItem,
  TextOption
} from '../utility/options-handler.js'
import { InputStyle, OptionsHandler, OptionType } from '../utility/options-handler.js'

const Essential = ':shield:'
const Recommended = ':beginner:'
const Warning = ':warning:'

const CategoryLabel =
  `Options marked with ${Essential} are essential. Change at your own risk.\n` +
  `Options marked with ${Recommended} are recommended for quality of life.\n` +
  `Options marked with ${Warning} should only be messed with if you know what you are doing.\n` +
  `Check [the documentations](https://github.com/aidn3/hypixel-guild-discord-bridge/blob/master/docs/FAQ.md) for more information.`

const GuildReactionMessageInputId = 'guild-reaction-message-input'
const GuildReactionMessageLimit = 20

interface GuildReactionMessageEditorConfig {
  /** Disambiguates stableIds across bridges (multi-bridge); must match the bridge this list belongs to. */
  scopeId: string
  // key is intentionally a string to allow reuse across different message lists
  key: string
  name: string
  description: string
  fallbackMessages: string[]
  getMessages: () => string[]
  setMessages: (messages: string[]) => void
  /** When set, included in persistence debug logs (per-bridge lists). */
  debugContext?: { bridgeId?: string }
}

function logGuildReactionMessageListMutation(
  config: GuildReactionMessageEditorConfig,
  action: 'add' | 'edit' | 'delete',
  data: Record<string, unknown>
): void {
  debugSessionLog({
    hypothesisId: 'H-guild-msg-list',
    location: `settings.ts:guildReactionMessages:${action}`,
    message: `Guild reaction message list ${action}`,
    data: {
      listKey: config.key,
      bridgeId: config.debugContext?.bridgeId,
      ...data
    }
  })
}

function createGuildReactionMessageListOption(config: GuildReactionMessageEditorConfig): CategoryOption {
  return {
    type: OptionType.Category,
    name: config.name,
    description: config.description,
    stableId: `guild-reaction:${config.scopeId}:${config.key}:root`,
    header:
      `**${config.name}**\n\n` +
      `View existing messages and manage this list.\n` +
      `Use \`{username}\` for the player name.`,
    get options() {
      const options: CategoryOption['options'] = []

      if (config.getMessages().length === 0) {
        options.push({
          type: OptionType.Label,
          name: 'Current Messages',
          description: 'Preview of all current messages in this list.',
          stableId: `guild-reaction:${config.scopeId}:${config.key}:label:empty`,
          getOption: () => formatGuildReactionMessageList(config.getMessages())
        } satisfies LabelOption)
      } else {
        const messages = config.getMessages()
        // For each message, expose a label and explicit Edit / Delete actions
        for (let index = 0; index < messages.length; index++) {
          const messageIndex = index
          const raw = messages[messageIndex]

          options.push({
            type: OptionType.Label,
            name: `#${messageIndex + 1} ${formatGuildReactionMessagePreview(raw)}`,
            description: 'Message preview',
            stableId: `guild-reaction:${config.scopeId}:${config.key}:label:${messageIndex}`,
            getOption: undefined
          } satisfies LabelOption)

          options.push({
            type: OptionType.Action,
            name: `Edit Message #${messageIndex + 1}`,
            description: `Edit message #${messageIndex + 1}`,
            stableId: `guild-reaction:${config.scopeId}:${config.key}:edit:${messageIndex}`,
            label: 'Edit',
            style: ButtonStyle.Primary,
            onInteraction: async (interaction: ButtonInteraction, errorHandler, helpers) =>
              handleGuildReactionMessageEdit(interaction, config, messageIndex, helpers)
          } satisfies ActionOption)

          options.push({
            type: OptionType.Action,
            name: `Delete Message #${messageIndex + 1}`,
            description: `Delete message #${messageIndex + 1}`,
            stableId: `guild-reaction:${config.scopeId}:${config.key}:delete:${messageIndex}`,
            label: 'Delete',
            style: ButtonStyle.Danger,
            onInteraction: async (interaction: ButtonInteraction, errorHandler, helpers) =>
              handleGuildReactionMessageDelete(interaction, config, messageIndex, helpers)
          } satisfies ActionOption)
        }
      }

      options.push({
        type: OptionType.Action,
        name: 'Add Message',
        description: `Add a new custom ${config.key} message.`,
        stableId: `guild-reaction:${config.scopeId}:${config.key}:add`,
        label: 'Add',
        style: ButtonStyle.Success,
        onInteraction: async (interaction: ButtonInteraction, errorHandler, helpers) =>
          addGuildReactionMessage(interaction, config, helpers)
      } satisfies ActionOption)

      return options
    }
  }
}

async function handleGuildReactionMessageDelete(
  interaction: ButtonInteraction,
  config: GuildReactionMessageEditorConfig,
  index: number,
  helpers?: ActionInteractionHelpers
): Promise<boolean> {
  const allMessages = getGuildReactionMessagesForMutation(config)

  if (index < 0 || index >= allMessages.length) {
    await interaction.reply({ content: 'Message not found.', flags: MessageFlags.Ephemeral })
    return true
  }

  const removed = allMessages[index]
  const newMessages = [...allMessages.slice(0, index), ...allMessages.slice(index + 1)]
  config.setMessages(newMessages)

  const readBack = config.getMessages()
  if (!areMessageListsEqual(readBack, newMessages)) {
    logGuildReactionMessageListMutation(config, 'delete', {
      beforeLen: allMessages.length,
      expectedLen: newMessages.length,
      readBackLen: readBack.length,
      ok: false
    })
    config.setMessages(allMessages)
    await interaction.reply({
      content:
        '**Delete failed:** the message list could not be updated. Please try again or check database connectivity.',
      flags: MessageFlags.Ephemeral
    })
    if (helpers) {
      try {
        await helpers.updateView()
      } catch {
        // ignore update failures
      }
    }
    return true
  }

  logGuildReactionMessageListMutation(config, 'delete', {
    beforeLen: allMessages.length,
    afterLen: readBack.length,
    ok: true
  })

  await interaction.reply({
    content: `Deleted message: **${formatGuildReactionMessagePreview(removed)}**`,
    flags: MessageFlags.Ephemeral
  })

  if (helpers) {
    // If called from the OptionsHandler flow, refresh the view so the deleted item disappears
    try {
      await helpers.updateView()
    } catch {
      // ignore update failures
    }
  }

  return true
}

async function handleGuildReactionMessageEdit(
  interaction: ButtonInteraction,
  config: GuildReactionMessageEditorConfig,
  index: number,
  helpers: ActionInteractionHelpers
): Promise<boolean> {
  const allMessagesBeforeModal = getGuildReactionMessagesForMutation(config)

  if (index < 0 || index >= allMessagesBeforeModal.length) {
    await interaction.reply({ content: 'Message not found.', flags: MessageFlags.Ephemeral })
    return true
  }

  const modalCustomId = `guild-reaction-edit-${config.scopeId}-${config.key}-${index}`
  const current = allMessagesBeforeModal[index]

  await interaction.showModal({
    customId: modalCustomId,
    title: `Edit Message #${index + 1}`,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            customId: GuildReactionMessageInputId,
            style: TextInputStyle.Paragraph,
            label: config.name,
            minLength: 1,
            required: true,
            value: current
          }
        ]
      }
    ]
  })

  const modalInteraction = await interaction.awaitModalSubmit({
    time: 300_000,
    filter: (submittedInteraction) =>
      submittedInteraction.user.id === interaction.user.id && submittedInteraction.customId === modalCustomId
  })

  const value = modalInteraction.fields.getTextInputValue(GuildReactionMessageInputId).trim()

  if (value.length === 0) {
    await modalInteraction.reply({ content: 'Message cannot be empty.', flags: MessageFlags.Ephemeral })
    return true
  }

  const allMessages = getGuildReactionMessagesForMutation(config)
  if (index < 0 || index >= allMessages.length) {
    await modalInteraction.reply({ content: 'Message not found.', flags: MessageFlags.Ephemeral })
    return true
  }

  // Prevent duplicates (allow replacing same index with same value)
  if (allMessages.some((message, messageIndex) => messageIndex !== index && message === value)) {
    await modalInteraction.reply({
      content: `This message already exists in **${config.name}**.`,
      flags: MessageFlags.Ephemeral
    })
    return true
  }

  const newMessages = [...allMessages]
  newMessages[index] = value
  config.setMessages(newMessages)

  const readBack = config.getMessages()
  if (!areMessageListsEqual(readBack, newMessages)) {
    logGuildReactionMessageListMutation(config, 'edit', {
      index,
      expectedLen: newMessages.length,
      readBackLen: readBack.length,
      ok: false
    })
    config.setMessages(allMessages)
    await modalInteraction.reply({
      content:
        '**Save failed:** the message list could not be updated. Please try again or check database connectivity.',
      flags: MessageFlags.Ephemeral
    })
    return true
  }

  logGuildReactionMessageListMutation(config, 'edit', {
    index,
    afterLen: readBack.length,
    ok: true
  })

  await modalInteraction.reply({
    content: `Updated message **#${index + 1}** in **${config.name}**: ${escapeMarkdown(formatGuildReactionMessagePreview(value))}`,
    flags: MessageFlags.Ephemeral
  })

  assert.ok(modalInteraction.isFromMessage())
  await helpers.updateView(modalInteraction)
  return true
}

async function addGuildReactionMessage(
  interaction: ButtonInteraction,
  config: GuildReactionMessageEditorConfig,
  helpers: ActionInteractionHelpers
): Promise<boolean> {
  const modalCustomId = `guild-reaction-add-${config.scopeId}-${config.key}`
  const beforeMessages = config.getMessages()
  if (beforeMessages.length >= GuildReactionMessageLimit) {
    await interaction.reply({
      content: `You can only store up to ${GuildReactionMessageLimit} messages in this list.`,
      flags: MessageFlags.Ephemeral
    })
    return true
  }

  await interaction.showModal({
    customId: modalCustomId,
    title: `Add To ${config.name}`,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            customId: GuildReactionMessageInputId,
            style: TextInputStyle.Paragraph,
            label: config.name,
            minLength: 1,
            required: true
          }
        ]
      }
    ]
  })

  const modalInteraction = await interaction.awaitModalSubmit({
    time: 300_000,
    filter: (submittedInteraction) =>
      submittedInteraction.user.id === interaction.user.id && submittedInteraction.customId === modalCustomId
  })

  const value = modalInteraction.fields.getTextInputValue(GuildReactionMessageInputId).trim()
  const allMessages = getGuildReactionMessagesForMutation(config)

  if (value.length === 0) {
    await modalInteraction.reply({
      content: 'Message cannot be empty.',
      flags: MessageFlags.Ephemeral
    })
    return true
  }

  if (allMessages.includes(value)) {
    await modalInteraction.reply({
      content: `This message already exists in **${config.name}**.`,
      flags: MessageFlags.Ephemeral
    })
    return true
  }

  if (allMessages.length >= GuildReactionMessageLimit) {
    await modalInteraction.reply({
      content: `You can only store up to ${GuildReactionMessageLimit} messages in this list.`,
      flags: MessageFlags.Ephemeral
    })
    return true
  }

  const expected = [...allMessages, value]
  config.setMessages(expected)

  const readBack = config.getMessages()
  if (!areMessageListsEqual(readBack, expected)) {
    logGuildReactionMessageListMutation(config, 'add', {
      beforeLen: allMessages.length,
      expectedLen: expected.length,
      readBackLen: readBack.length,
      ok: false
    })
    config.setMessages(allMessages)
    await modalInteraction.reply({
      content:
        '**Save failed:** the message list could not be updated. Please try again or check database connectivity.',
      flags: MessageFlags.Ephemeral
    })
    return true
  }

  logGuildReactionMessageListMutation(config, 'add', {
    beforeLen: allMessages.length,
    afterLen: readBack.length,
    ok: true
  })

  await modalInteraction.reply({
    content: `Saved message **#${readBack.length}** in **${config.name}**: ${escapeMarkdown(formatGuildReactionMessagePreview(value))}`,
    flags: MessageFlags.Ephemeral
  })

  assert.ok(modalInteraction.isFromMessage())
  await helpers.updateView(modalInteraction)

  return true
}

function formatGuildReactionMessagePreview(message: string): string {
  const trimmed = message.replaceAll(/\s+/g, ' ').trim()
  if (trimmed.length === 0) return '(empty message)'

  const maxLength = 120
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 3)}...`
}

function formatGuildReactionMessageList(messages: string[]): string {
  if (messages.length === 0) return '(empty)'
  return messages.map((message, index) => `${index + 1}. ${formatGuildReactionMessagePreview(message)}`).join('\n')
}

function ensureGuildReactionMessagesWritable(config: GuildReactionMessageEditorConfig): string[] {
  const currentMessages = config.getMessages()
  if (areMessageListsEqual(currentMessages, config.fallbackMessages)) {
    config.setMessages([...currentMessages])
    return config.getMessages()
  }

  return currentMessages
}

/** Writable guild reaction message list; call after any await before mutating config. */
function getGuildReactionMessagesForMutation(config: GuildReactionMessageEditorConfig): string[] {
  return ensureGuildReactionMessagesWritable(config)
}

function areMessageListsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function translateStatusForBridge(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: Status
): string {
  switch (status) {
    case Status.Fresh: {
      return t('instance.status.fresh')
    }
    case Status.Connecting: {
      return t('instance.status.connecting')
    }
    case Status.Connected: {
      return t('instance.status.connected')
    }
    case Status.Disconnected: {
      return t('instance.status.disconnected')
    }
    case Status.Ended: {
      return t('instance.status.ended')
    }
    case Status.Failed: {
      return t('instance.status.failed')
    }
    default: {
      throw new Error(`Unknown status: ${JSON.stringify(status)}`)
    }
  }
}

function translateInstanceStatusForBridge(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: { from: Status; to: Status }
): string {
  return t('instance.status.change', {
    from: translateStatusForBridge(t, status.from),
    to: translateStatusForBridge(t, status.to)
  })
}

function translateInstanceMessageForBridge(
  t: (key: string, options?: Record<string, unknown>) => string,
  key: InstanceMessageType
): string {
  switch (key) {
    case InstanceMessageType.MinecraftAuthenticationCode: {
      return t('instance.message.authentication-code')
    }
    case InstanceMessageType.MinecraftInstanceNotAutoConnect: {
      return t('instance.message.no-autoconnect')
    }
    case InstanceMessageType.MinecraftKicked: {
      return t('instance.message.minecraft-kicked')
    }
    case InstanceMessageType.MinecraftBanned: {
      return t('instance.message.minecraft-banned')
    }
    case InstanceMessageType.MinecraftInternetProblems: {
      return t('instance.message.internet-problems')
    }
    case InstanceMessageType.MinecraftFailedTooManyTimes: {
      return t('instance.message.failed-too-many-times')
    }
    case InstanceMessageType.MinecraftEnded: {
      return t('instance.message.minecraft-ended')
    }
    case InstanceMessageType.MinecraftIncompatible: {
      return t('instance.message.version-incompatible')
    }
    case InstanceMessageType.MinecraftKickedLoggedFromAnotherLocation: {
      return t('instance.message.logged-from-another-location')
    }
    case InstanceMessageType.MinecraftXboxDown: {
      return t('instance.message.xbox-down')
    }
    case InstanceMessageType.MinecraftXboxThrottled: {
      return t('instance.message.xbox-throttled')
    }
    case InstanceMessageType.MinecraftNoAccount: {
      return t('instance.message.no-account')
    }
    case InstanceMessageType.MinecraftProxyBroken: {
      return t('instance.message.proxy-problem')
    }
    case InstanceMessageType.MinecraftRestarting: {
      return t('instance.message.restarting')
    }
    case InstanceMessageType.MinecraftGuildKicked: {
      return t('instance.message.guild-kicked')
    }
    default: {
      throw new Error(`Unknown instance message type: ${JSON.stringify(key)}`)
    }
  }
}

export default {
  getCommandBuilder: () =>
    new SlashCommandBuilder().setName('settings').setDescription('Control application settings.'),
  permission: Permission.Officer,

  handler: async function (context) {
    const isGlobalAdmin = context.permission === Permission.Admin
    const bridgeId = context.bridgeId

    if (!isGlobalAdmin && bridgeId === undefined) {
      await context.interaction.reply({
        content: 'You do not have permission to use this command here.',
        flags: MessageFlags.Ephemeral
      })
      return
    }

    const bridgeOptions = await fetchBridgeOptions(context.application, context)

    const optionsList: Exclude<OptionItem, EmbedCategoryOption>[] = [
      ...(isGlobalAdmin
        ? [
            {
              type: OptionType.Label,
              name: 'Admins',
              description:
                'Users who have admin permission on the application. Check `/help` for all commands available to you.',
              getOption: () =>
                context.application.discordInstance
                  .getStaticConfig()
                  .adminIds.map((adminId) => `<@${adminId}>`)
                  .join(', ')
            } satisfies LabelOption,
            fetchGeneralOptions(context.application)
          ]
        : []),
      bridgeOptions,
      fetchMinecraftOptions(context.application, context),
      ...(isGlobalAdmin
        ? [
            fetchDiscordOptions(context.application),
            fetchModerationOptions(context.application),
            fetchQualityOptions(context.application),
            fetchCommandsOptions(context.application),
            fetchLanguageOptions(context.application)
          ]
        : [])
    ]

    const options: EmbedCategoryOption = {
      type: OptionType.EmbedCategory,
      get name() {
        return context.application.i18n.t(($) => $['discord.commands.settings.main.title'])
      },
      get description() {
        return context.application.i18n.t(($) => $['discord.commands.settings.main.description'])
      },

      options: optionsList
    }

    const optionsHandler = new OptionsHandler(options)
    await optionsHandler.forwardInteraction(context.interaction, context.errorHandler)
  }
} satisfies DiscordCommandHandler

function fetchGeneralOptions(application: Application): CategoryOption {
  const generalConfig = application.core.applicationConfigurations

  return {
    type: OptionType.Category,
    name: 'General',
    header: CategoryLabel,
    options: [
      {
        type: OptionType.Boolean,
        name: `Auto Restart ${Recommended}`,
        description: 'Schedule restarting every 24 hours.',
        getOption: () => generalConfig.getAutoRestart(),
        toggleOption: () => {
          generalConfig.setAutoRestart(!generalConfig.getAutoRestart())
        }
      },
      {
        type: OptionType.Boolean,
        name: `Add origin tag`,
        description: "Adds an origin tag to messages that show where it's coming from.",
        getOption: () => generalConfig.getOriginTag(),
        toggleOption: () => {
          generalConfig.setOriginTag(!generalConfig.getOriginTag())
        }
      }
    ]
  }
}

/**
 * Creates a bridge option category for a specific bridge ID
 * Each bridge has its own complete settings panel
 */
function createBridgeOption(
  application: Application,
  bridgeId: string,
  bridgeSubOptions: CategoryOption['options']
): Promise<CategoryOption> {
  return createBridgeOptionAsync(application, bridgeId, bridgeSubOptions)
}

async function createBridgeOptionAsync(
  application: Application,
  bridgeId: string,
  bridgeSubOptions: CategoryOption['options']
): Promise<CategoryOption> {
  const bridgeConfig = application.core.bridgeConfigurations

  let guildRanks: string[] = []
  try {
    const instances = bridgeConfig.getMinecraftInstances(bridgeId)
    if (instances.length > 0) {
      const botName = instances[0]
      const guild = await application.hypixelApi.getGuild('player', botName).catch(() => undefined)
      if (guild?.ranks) {
        guildRanks = guild.ranks.map((r) => r.name)
      }
    }
  } catch (error) {
    debugSessionLog({
      hypothesisId: 'H9',
      location: 'settings.ts:createBridgeOptionAsync:guildRanks',
      message: `Failed to fetch guild ranks for bridge ${bridgeId}`,
      data: { bridgeId, error: errorMessage(error) }
    })
  }

  let cachedPromotionOptions: CategoryOption['options'] | undefined
  let cachedDemotionOptions: CategoryOption['options'] | undefined

  // Dynamic Skyblock options for per-event toggling
  const skyblockEventOptions = SkyblockEventKeys.map(
    (key) =>
      ({
        type: OptionType.Boolean,
        name: key,
        description: `Enable notifications for ${key}`,
        getOption: () => bridgeConfig.getSkyblockEventNotifiers(bridgeId)?.[key] ?? true,
        toggleOption: () => {
          const current = bridgeConfig.getSkyblockEventNotifiers(bridgeId) ?? {}
          bridgeConfig.setSkyblockEventNotifier(bridgeId, key, !(current[key] ?? true))
          application
            .emit('bridgeConfigChanged', {
              bridgeId,
              key: `${bridgeId}_skyblockNotifiers`,
              value: { [key]: !(current[key] ?? true) }
            })
            .catch((error: unknown) => {
              debugSessionLog({
                hypothesisId: 'H9',
                location: 'settings.ts:skyblockNotifier:emit',
                message: 'Failed to emit bridgeConfigChanged for skyblock notifier',
                data: { bridgeId, key, error: errorMessage(error) }
              })
            })
        }
      }) satisfies BooleanOption as BooleanOption
  )

  return {
    type: OptionType.Category,
    name: `Bridge: ${bridgeId}`,
    description: `Configure bridge "${bridgeId}"`,
    header:
      `**Bridge Configuration: ${bridgeId}**\n\n` +
      `Each bridge has its own complete settings. Configure channels, roles, and behavior for this bridge.\n` +
      `Messages will only be routed between instances/channels in the same bridge.`,
    options: [
      // ========== Channels Category ==========
      {
        type: OptionType.Category,
        name: 'Channels',
        description: 'Configure Discord channels for this bridge',
        header: `**Channel Configuration for ${bridgeId}**\n\nSet up the Discord channels that will be connected to this bridge.`,
        options: [
          {
            type: OptionType.Channel,
            name: `Public Channels ${Essential}`,
            description: `Public guild chat channels for bridge "${bridgeId}"`,
            min: 0,
            max: 5,
            getOption: () => bridgeConfig.getPublicChannelIds(bridgeId),
            setOption: (values) => {
              bridgeConfig.setPublicChannelIds(bridgeId, values)
              application.bridgeResolver.rebuildLookupMaps()
            }
          },
          {
            type: OptionType.Channel,
            name: `Officer Channels`,
            description: `Officer guild chat channels for bridge "${bridgeId}"`,
            min: 0,
            max: 5,
            getOption: () => bridgeConfig.getOfficerChannelIds(bridgeId),
            setOption: (values) => {
              bridgeConfig.setOfficerChannelIds(bridgeId, values)
              application.bridgeResolver.rebuildLookupMaps()
            }
          },
          {
            type: OptionType.Channel,
            name: `Logger Channels`,
            description: `Channels where application logs are sent for bridge "${bridgeId}". This is for staff only!`,
            min: 0,
            max: 5,
            getOption: () => bridgeConfig.getLoggerChannelIds(bridgeId),
            setOption: (values) => {
              bridgeConfig.setLoggerChannelIds(bridgeId, values)
              application.bridgeResolver.rebuildLookupMaps()
            }
          }
        ]
      },
      // ========== Minecraft Instances ==========
      {
        type: OptionType.List,
        name: `Minecraft Instances`,
        description: `Minecraft instance names that belong to bridge "${bridgeId}"`,
        style: InputStyle.Short,
        min: 0,
        max: 10,
        getOption: () => bridgeConfig.getMinecraftInstances(bridgeId),
        setOption: (values) => {
          bridgeConfig.setMinecraftInstances(bridgeId, values)
          application.bridgeResolver.rebuildLookupMaps()
        }
      },
      // ========== Roles Category ==========
      {
        type: OptionType.Category,
        name: 'Staff Roles',
        description: 'Configure staff roles for this bridge',
        header: `**Staff Roles for ${bridgeId}**\n\nAssign staff roles that have special permissions in this bridge.`,
        options: [
          {
            type: OptionType.Role,
            name: 'Helper Roles',
            description: `Staff roles that have permissions to execute commands such as \`!toggle\` and \`/invite\` in bridge "${bridgeId}"`,
            min: 0,
            max: 5,
            getOption: () => bridgeConfig.getHelperRoleIds(bridgeId),
            setOption: (values) => {
              bridgeConfig.setHelperRoleIds(bridgeId, values)
            }
          },
          {
            type: OptionType.Role,
            name: `Owner Roles ${Warning}`,
            description:
              `Staff roles that have access to destructive commands like \`/ban\` and \`/kick\` in bridge "${bridgeId}". ` +
              `Only assign to trusted users.`,
            min: 0,
            max: 5,
            getOption: () => bridgeConfig.getOwnerRoleIds(bridgeId),
            setOption: (values) => {
              bridgeConfig.setOwnerRoleIds(bridgeId, values)
            }
          },
          {
            type: OptionType.Role,
            name: 'Officer Roles',
            description: `Staff roles that have permissions to execute non-destructive moderation commands like \`/punishments mute\` in bridge "${bridgeId}"`,
            min: 0,
            max: 5,
            getOption: () => bridgeConfig.getOfficerRoleIds(bridgeId),
            setOption: (values) => {
              bridgeConfig.setOfficerRoleIds(bridgeId, values)
            }
          }
        ]
      },
      // ========== Discord Settings Category ==========
      {
        type: OptionType.Category,
        name: 'Discord Settings',
        description: 'Configure Discord behavior for this bridge',
        header: `**Discord Settings for ${bridgeId}**\n\nConfigure how the bridge interacts with Discord.`,
        options: [
          {
            type: OptionType.Boolean,
            name: 'Always Reply',
            description: 'Enable to always send a text reply instead of reactions when a problem occurs.',
            getOption: () => bridgeConfig.getAlwaysReplyReaction(bridgeId),
            toggleOption: () => {
              bridgeConfig.setAlwaysReplyReaction(bridgeId, !bridgeConfig.getAlwaysReplyReaction(bridgeId))
            }
          },
          {
            type: OptionType.Boolean,
            name: 'Enforce Verification',
            description: 'Enable to always require verification via `/verify` to chat using this bridge.',
            getOption: () => bridgeConfig.getEnforceVerification(bridgeId),
            toggleOption: () => {
              bridgeConfig.setEnforceVerification(bridgeId, !bridgeConfig.getEnforceVerification(bridgeId))
            }
          },
          {
            type: OptionType.Boolean,
            name: 'Minecraft Text Images',
            description: 'Render chat messages the same way they are rendered in Minecraft in-game.',
            getOption: () => bridgeConfig.getTextToImage(bridgeId),
            toggleOption: () => {
              bridgeConfig.setTextToImage(bridgeId, !bridgeConfig.getTextToImage(bridgeId))
            }
          },
          {
            type: OptionType.PresetList,
            name: 'Language',
            description: 'Preferred language for this bridge. Leave empty to use the global application language.',
            getOption: () => {
              const v = bridgeConfig.getLanguage(bridgeId)
              return v ? [v] : []
            },
            setOption: (values) => {
              const lang = values.length > 0 ? values[0] : undefined
              bridgeConfig.setLanguage(bridgeId, lang)
            },
            min: 0,
            max: 1,
            options: Object.values(ApplicationLanguages).map((value) => ({ label: value, value: value }))
          }
        ]
      },
      // ========== Events Category ==========
      {
        type: OptionType.Category,
        name: 'Minecraft Events',
        description: 'Configure event notifications for this bridge',
        header: `**Event Settings for ${bridgeId}**\n\nConfigure how Minecraft events are displayed in Discord.`,
        options: [
          {
            type: OptionType.Boolean,
            name: `Member Online ${Recommended}`,
            description: 'Show a temporary message when a guild member comes online.',
            getOption: () => bridgeConfig.getGuildOnline(bridgeId),
            toggleOption: () => {
              bridgeConfig.setGuildOnline(bridgeId, !bridgeConfig.getGuildOnline(bridgeId))
            }
          },
          {
            type: OptionType.Boolean,
            name: `Member Offline ${Recommended}`,
            description: 'Show a temporary message when a guild member goes offline.',
            getOption: () => bridgeConfig.getGuildOffline(bridgeId),
            toggleOption: () => {
              bridgeConfig.setGuildOffline(bridgeId, !bridgeConfig.getGuildOffline(bridgeId))
            }
          },
          {
            type: OptionType.Boolean,
            name: 'Persist Online/Offline Messages',
            description: 'Keep online/offline status messages instead of deleting them after a period of time.',
            getOption: () => bridgeConfig.getPersistGuildOnlineOffline(bridgeId),
            toggleOption: () => {
              bridgeConfig.setPersistGuildOnlineOffline(bridgeId, !bridgeConfig.getPersistGuildOnlineOffline(bridgeId))
            }
          },
          {
            type: OptionType.EmbedCategory,
            name: 'When NOT Persisted',
            description: 'Settings for how long to keep messages when persistence is disabled.',
            options: [
              {
                type: OptionType.Number,
                name: 'Delete After (Seconds)',
                description: 'How long to keep temporary events before deleting them.',
                min: 1,
                max: 43_200,
                getOption: () => bridgeConfig.getDurationTemporarilyInteractions(bridgeId).toSeconds(),
                setOption: (value) => {
                  bridgeConfig.setDurationTemporarilyInteractions(bridgeId, Duration.seconds(value))
                }
              },
              {
                type: OptionType.Number,
                name: 'Max Events',
                description: 'How many temporary events to keep before deleting older ones.',
                min: 1,
                max: 1000,
                getOption: () => bridgeConfig.getMaxTemporarilyInteractions(bridgeId),
                setOption: (value) => {
                  bridgeConfig.setMaxTemporarilyInteractions(bridgeId, value)
                }
              }
            ]
          },
          // Random Chatter
          {
            type: OptionType.Category,
            name: 'Random Chatter',
            description:
              'Periodic random messages the bot will say in guild chat. With Include Player Name on, messages without {username} get a random online member prefixed as Name: …; use {username} inside a line to place a name yourself.',
            options: [
              {
                type: OptionType.Boolean,
                name: 'Enable Random Chatter',
                description: 'Enable periodic random messages for this bridge.',
                getOption: () => bridgeConfig.getRandomChatterEnabled(bridgeId),
                toggleOption: () => {
                  bridgeConfig.setRandomChatterEnabled(bridgeId, !bridgeConfig.getRandomChatterEnabled(bridgeId))
                }
              },
              {
                type: OptionType.Number,
                name: 'Interval Minutes',
                description: 'How many minutes between each random message.',
                min: 1,
                max: 1440,
                getOption: () => bridgeConfig.getRandomChatterIntervalMinutes(bridgeId),
                setOption: (value) => {
                  bridgeConfig.setRandomChatterIntervalMinutes(bridgeId, value)
                }
              },
              {
                type: OptionType.Number,
                name: 'Minimum Online Players',
                description: 'How many online members must be present for the bot to send a message.',
                min: 1,
                max: 100,
                getOption: () => bridgeConfig.getRandomChatterMinimumOnlinePlayers(bridgeId),
                setOption: (value) => {
                  bridgeConfig.setRandomChatterMinimumOnlinePlayers(bridgeId, value)
                }
              },
              {
                type: OptionType.Boolean,
                name: 'Use Bot Name Instead of Random Player',
                description:
                  'When ON: use this bridge bot\'s Minecraft username for {username} and prefix plain lines as "BotName: message".\nWhen OFF: send templates exactly as written or leave {username} to be substituted by a random online player.',
                getOption: () => bridgeConfig.getRandomChatterIncludePlayerName(bridgeId),
                toggleOption: () => {
                  bridgeConfig.setRandomChatterIncludePlayerName(
                    bridgeId,
                    !bridgeConfig.getRandomChatterIncludePlayerName(bridgeId)
                  )
                }
              },
              createGuildReactionMessageListOption({
                scopeId: bridgeId,
                key: 'randomChatter',
                name: 'Random Chatter Messages',
                description:
                  'One message per line. Use {username} where you want a random online player name. If Include Player Name is on and a line has no {username}, the bot prefixes a random online player as Username: …',
                fallbackMessages: [],
                getMessages: () => bridgeConfig.getRandomChatterMessages(bridgeId, []),
                setMessages: (values) => {
                  bridgeConfig.setRandomChatterMessages(bridgeId, values)
                },
                debugContext: { bridgeId }
              }),
              {
                type: OptionType.Number,
                name: 'Anti-Repeat Length',
                description:
                  'Avoid reusing the same message within the last N sent messages for this bridge (0 = disabled).',
                min: 0,
                max: 50,
                getOption: () => bridgeConfig.getRandomChatterAntiRepeatLength(bridgeId),
                setOption: (value) => {
                  bridgeConfig.setRandomChatterAntiRepeatLength(bridgeId, value)
                }
              },
              {
                type: OptionType.Number,
                name: 'Quiet Window Minutes',
                description:
                  'If set, suppress random chatter for this many minutes after real guild chat activity (0 = disabled).',
                min: 0,
                max: 60,
                getOption: () => bridgeConfig.getRandomChatterQuietWindowMinutes(bridgeId),
                setOption: (value) => {
                  bridgeConfig.setRandomChatterQuietWindowMinutes(bridgeId, value)
                }
              },
              {
                type: OptionType.Action,
                name: 'Send Test Chatter',
                description: 'Send one test random chatter message now for this bridge.',
                stableId: `guild-reaction:${bridgeId}:randomChatter:sendTest`,
                label: 'Send Test',
                style: ButtonStyle.Primary,
                onInteraction: async (interaction: ButtonInteraction, errorHandler, helpers) => {
                  try {
                    const result = await application.randomChatter.sendTest(bridgeId)
                    await interaction.reply({
                      content: result.sent ? `Sent: ${result.message}` : `Not sent: ${result.reason}`,
                      flags: MessageFlags.Ephemeral
                    })
                  } catch (error) {
                    await interaction.reply({
                      content: `Failed to send test chatter: ${String(error)}`,
                      flags: MessageFlags.Ephemeral
                    })
                  }
                  return true
                }
              }
            ]
          }
        ]
      },
      // ========== Skyblock Events ==========
      {
        type: OptionType.Category,
        name: 'Skyblock Events',
        description: 'Configure Skyblock event notifications for this bridge',
        header: `**Skyblock Events for ${bridgeId}**\n\nConfigure Skyblock event notifications.`,
        options: [
          {
            type: OptionType.Boolean,
            name: 'Skyblock Events',
            description: 'Enable or disable Skyblock event notifications for this bridge',
            getOption: () => bridgeConfig.getSkyblockEventsEnabled(bridgeId),
            toggleOption: () => {
              const newValue = !bridgeConfig.getSkyblockEventsEnabled(bridgeId)
              bridgeConfig.setSkyblockEventsEnabled(bridgeId, newValue)
              application
                .emit('bridgeConfigChanged', {
                  bridgeId,
                  key: `${bridgeId}_skyblockEventsEnabled`,
                  value: newValue
                })
                .catch((error: unknown) => {
                  debugSessionLog({
                    hypothesisId: 'H9',
                    location: 'settings.ts:skyblockEvents:emit',
                    message: 'Failed to emit bridgeConfigChanged for skyblock events enabled',
                    data: { bridgeId, error: errorMessage(error) }
                  })
                })
            }
          },
          {
            type: OptionType.EmbedCategory,
            name: 'Skyblock Reminders',
            description: 'Special Skyblock event reminders.',
            options: [
              {
                type: OptionType.Boolean,
                name: 'Dark Auction Reminder',
                description: 'Send a reminder when a skyblock dark auction is starting.',
                getOption: () => bridgeConfig.getDarkAuctionReminder(bridgeId),
                toggleOption: () => {
                  bridgeConfig.setDarkAuctionReminder(bridgeId, !bridgeConfig.getDarkAuctionReminder(bridgeId))
                }
              },
              {
                type: OptionType.Boolean,
                name: 'Starfall Cult Reminder',
                description: 'Send a reminder when the skyblock starfall cult gathers.',
                getOption: () => bridgeConfig.getStarfallCultReminder(bridgeId),
                toggleOption: () => {
                  bridgeConfig.setStarfallCultReminder(bridgeId, !bridgeConfig.getStarfallCultReminder(bridgeId))
                }
              }
            ]
          },
          ...skyblockEventOptions
        ]
      },
      // ========== Quality of Life ==========
      {
        type: OptionType.Category,
        name: 'Quality of Life',
        description: 'Guild reactions and automated features',
        header: `**Quality of Life Settings**\n\nConfigure automated reactions and reminders.\n\n${CategoryLabel}`,
        options: [
          {
            type: OptionType.EmbedCategory,
            name: 'Guild Reactions',
            description: 'Auto replying and reacting to various in-game guild events.',
            options: [
              {
                type: OptionType.Boolean,
                name: 'Guild Join Reaction',
                description: 'Send a greeting message when a member joins the guild.',
                getOption: () => bridgeConfig.getJoinGuildReaction(bridgeId),
                toggleOption: () => {
                  bridgeConfig.setJoinGuildReaction(bridgeId, !bridgeConfig.getJoinGuildReaction(bridgeId))
                }
              },
              {
                type: OptionType.Boolean,
                name: 'Guild Leave Reaction',
                description: 'Send a reaction message when a member leaves the guild.',
                getOption: () => bridgeConfig.getLeaveGuildReaction(bridgeId),
                toggleOption: () => {
                  bridgeConfig.setLeaveGuildReaction(bridgeId, !bridgeConfig.getLeaveGuildReaction(bridgeId))
                }
              },
              {
                type: OptionType.Boolean,
                name: 'Guild Kick Reaction',
                description: 'Send a reaction message when a member is kicked from the guild.',
                getOption: () => bridgeConfig.getKickGuildReaction(bridgeId),
                toggleOption: () => {
                  bridgeConfig.setKickGuildReaction(bridgeId, !bridgeConfig.getKickGuildReaction(bridgeId))
                }
              }
            ]
          },
          {
            type: OptionType.Boolean,
            name: 'Announce Player Muted',
            description:
              'Announce to the guild about a player being muted when they send `/immuted` to the application in-game.',
            getOption: () => bridgeConfig.getAnnounceMutedPlayer(bridgeId),
            toggleOption: () => {
              bridgeConfig.setAnnounceMutedPlayer(bridgeId, !bridgeConfig.getAnnounceMutedPlayer(bridgeId))
            }
          }
        ]
      },
      // ========== Custom Messages ==========
      {
        type: OptionType.Category,
        name: 'Custom Messages',
        description: 'Customize automated messages and reactions',
        header: `**Custom Messages**\n\nCustomize the messages sent by the bot for various events.`,
        options: [
          {
            type: OptionType.Category,
            name: 'Guild Reaction Messages',
            description: 'Custom messages for guild join/leave/kick events.',
            options: [
              createGuildReactionMessageListOption({
                scopeId: bridgeId,
                key: 'join',
                name: 'Join Message List',
                description: 'Messages sent when a member joins the guild.',
                fallbackMessages: application.core.languageConfigurations.getGuildJoinReaction(),
                getMessages: () =>
                  bridgeConfig.getGuildJoinReactionMessages(
                    bridgeId,
                    application.core.languageConfigurations.getGuildJoinReaction()
                  ),
                setMessages: (values) => {
                  bridgeConfig.setGuildJoinReactionMessages(bridgeId, values)
                },
                debugContext: { bridgeId }
              }),
              createGuildReactionMessageListOption({
                scopeId: bridgeId,
                key: 'leave',
                name: 'Leave Message List',
                description: 'Messages sent when a member leaves the guild.',
                fallbackMessages: application.core.languageConfigurations.getGuildLeaveReaction(),
                getMessages: () =>
                  bridgeConfig.getGuildLeaveReactionMessages(
                    bridgeId,
                    application.core.languageConfigurations.getGuildLeaveReaction()
                  ),
                setMessages: (values) => {
                  bridgeConfig.setGuildLeaveReactionMessages(bridgeId, values)
                },
                debugContext: { bridgeId }
              }),
              createGuildReactionMessageListOption({
                scopeId: bridgeId,
                key: 'kick',
                name: 'Kick Message List',
                description: 'Messages sent when a member is kicked from the guild.',
                fallbackMessages: application.core.languageConfigurations.getGuildKickReaction(),
                getMessages: () =>
                  bridgeConfig.getGuildKickReactionMessages(
                    bridgeId,
                    application.core.languageConfigurations.getGuildKickReaction()
                  ),
                setMessages: (values) => {
                  bridgeConfig.setGuildKickReactionMessages(bridgeId, values)
                },
                debugContext: { bridgeId }
              })
            ]
          },
          {
            type: OptionType.Category,
            name: 'Skyblock Reminder Messages',
            description: 'Custom messages for Skyblock reminders.',
            options: [
              {
                type: OptionType.Text,
                name: 'Dark Auction Reminder',
                description: 'Message sent when dark auction is starting. Use {minutes} for time remaining.',
                style: InputStyle.Long,
                min: 2,
                max: 150,
                getOption: () =>
                  bridgeConfig.getDarkAuctionReminderMessage(
                    bridgeId,
                    application.core.languageConfigurations.getDarkAuctionReminder()
                  ),
                setOption: (value) => {
                  bridgeConfig.setDarkAuctionReminderMessage(bridgeId, value)
                }
              },
              {
                type: OptionType.Text,
                name: 'Starfall Cult Reminder',
                description: 'Message sent when starfall cult gathers.',
                style: InputStyle.Long,
                min: 2,
                max: 150,
                getOption: () =>
                  bridgeConfig.getStarfallReminderMessage(
                    bridgeId,
                    application.core.languageConfigurations.getStarfallReminder()
                  ),
                setOption: (value) => {
                  bridgeConfig.setStarfallReminderMessage(bridgeId, value)
                }
              }
            ]
          },
          {
            type: OptionType.Category,
            name: 'Other Reminder Messages',
            description: 'Custom messages for other automated reminders.',
            options: [
              {
                type: OptionType.Text,
                name: 'Announce Player Muted',
                description: 'Message when a player announces they are muted. Use {username} for the player name.',
                style: InputStyle.Long,
                min: 2,
                max: 150,
                getOption: () =>
                  bridgeConfig.getAnnounceMutedPlayerMessage(
                    bridgeId,
                    application.core.languageConfigurations.getAnnounceMutedPlayer()
                  ),
                setOption: (value) => {
                  bridgeConfig.setAnnounceMutedPlayerMessage(bridgeId, value)
                }
              }
            ]
          }
        ]
      },
      // ========== Moderation ==========
      {
        type: OptionType.Category,
        name: 'Moderation',
        description: 'Configure moderation settings for this bridge',
        header: `**Moderation Settings for ${bridgeId}**\n\nConfigure heat punishments and profanity filter for this bridge.\nLeave options at default to use global settings.`,
        options: [
          {
            type: OptionType.EmbedCategory,
            name: 'Heat Punishments',
            description: 'Limit staff moderation actions per day',
            options: [
              {
                type: OptionType.Boolean,
                name: `Enable Heat Punishment ${Essential}`,
                description:
                  'Enable to set limits to the amount of actions staff can take before being blocked. Leave unchanged to use global setting.',
                getOption: () =>
                  bridgeConfig.getHeatPunishmentEnabled(bridgeId) ??
                  application.core.moderationConfiguration.getHeatPunishment(),
                toggleOption: () => {
                  const current = bridgeConfig.getHeatPunishmentEnabled(bridgeId)
                  const globalValue = application.core.moderationConfiguration.getHeatPunishment()
                  if (current === undefined) {
                    // First toggle: set to opposite of global
                    bridgeConfig.setHeatPunishmentEnabled(bridgeId, !globalValue)
                  } else {
                    // Toggle current value
                    bridgeConfig.setHeatPunishmentEnabled(bridgeId, !current)
                  }
                }
              },
              {
                type: OptionType.Number,
                name: 'Kicks Per Day',
                description: 'Allowed kicks per day for staff before they are blocked. Set to 0 to use global setting.',
                min: 0,
                max: 100,
                getOption: () =>
                  bridgeConfig.getKicksPerDay(bridgeId) ?? application.core.moderationConfiguration.getKicksPerDay(),
                setOption: (value) => {
                  if (value === 0) {
                    bridgeConfig.setKicksPerDay(bridgeId, undefined)
                  } else {
                    bridgeConfig.setKicksPerDay(bridgeId, value)
                  }
                }
              },
              {
                type: OptionType.Number,
                name: 'Mutes Per Day',
                description: 'Allowed mutes per day for staff before they are blocked. Set to 0 to use global setting.',
                min: 0,
                max: 100,
                getOption: () =>
                  bridgeConfig.getMutesPerDay(bridgeId) ?? application.core.moderationConfiguration.getMutesPerDay(),
                setOption: (value) => {
                  if (value === 0) {
                    bridgeConfig.setMutesPerDay(bridgeId, undefined)
                  } else {
                    bridgeConfig.setMutesPerDay(bridgeId, value)
                  }
                }
              }
            ]
          },
          {
            type: OptionType.EmbedCategory,
            name: 'Immunity List',
            description: 'Users who are completely immune to heat punishments for this bridge',
            options: [
              {
                type: OptionType.User,
                name: 'Immune Discord Users',
                min: 0,
                max: 10,
                getOption: () => bridgeConfig.getImmuneDiscordUsers(bridgeId),
                setOption: (values) => {
                  bridgeConfig.setImmuneDiscordUsers(bridgeId, values)
                }
              },
              {
                type: OptionType.List,
                name: 'Immune Mojang Players',
                style: InputStyle.Short,
                min: 0,
                max: 10,
                getOption: () => bridgeConfig.getImmuneMojangPlayers(bridgeId),
                setOption: (values) => {
                  bridgeConfig.setImmuneMojangPlayers(bridgeId, values)
                }
              }
            ]
          },
          {
            type: OptionType.EmbedCategory,
            name: 'Profanity Filter',
            description: 'Filter and censor chat messages for profanity',
            options: [
              {
                type: OptionType.Boolean,
                name: `Profanity Filter ${Essential}`,
                description:
                  'Enable to filter and censor chat messages for profanity. Leave unchanged to use global setting.',
                getOption: () =>
                  bridgeConfig.getProfanityEnabled(bridgeId) ??
                  application.core.moderationConfiguration.getProfanityEnabled(),
                toggleOption: () => {
                  const current = bridgeConfig.getProfanityEnabled(bridgeId)
                  const globalValue = application.core.moderationConfiguration.getProfanityEnabled()
                  if (current === undefined) {
                    bridgeConfig.setProfanityEnabled(bridgeId, !globalValue)
                  } else {
                    bridgeConfig.setProfanityEnabled(bridgeId, !current)
                  }
                }
              },
              {
                type: OptionType.Label,
                name: 'Profanity List',
                description: 'Use command `/profanity` to edit the global filter.',
                getOption: undefined
              }
            ]
          }
        ]
      },
      // ========== Chat Commands ==========
      {
        type: OptionType.Category,
        name: 'Chat Commands',
        description: 'Configure chat commands for this bridge',
        header: `**Chat Commands for ${bridgeId}**\n\nConfigure chat commands like \`!cata\` and \`!iq\` for this bridge.\nLeave options at default to use global settings.`,
        options: [
          {
            type: OptionType.Boolean,
            name: `Enable Chat Commands ${Recommended}`,
            description: 'Enable commands such as `!cata` and `!iq` for this bridge.',
            getOption: () =>
              bridgeConfig.getCommandsEnabled(bridgeId) ?? application.core.commandsConfigurations.getCommandsEnabled(),
            toggleOption: () => {
              const current = bridgeConfig.getCommandsEnabled(bridgeId)
              const globalValue = application.core.commandsConfigurations.getCommandsEnabled()
              if (current === undefined) {
                bridgeConfig.setCommandsEnabled(bridgeId, !globalValue)
              } else {
                bridgeConfig.setCommandsEnabled(bridgeId, !current)
              }
            }
          },
          {
            type: OptionType.Text,
            name: 'Chat Command Prefix',
            description: 'Prefix to indicate it is a chat command. Leave empty to use global prefix.',
            style: InputStyle.Tiny,
            min: 0,
            max: 2,
            getOption: () =>
              bridgeConfig.getCommandPrefix(bridgeId) ?? application.core.commandsConfigurations.getChatPrefix(),
            setOption: (newValue) => {
              if (newValue === '' || newValue === application.core.commandsConfigurations.getChatPrefix()) {
                bridgeConfig.setCommandPrefix(bridgeId, undefined)
              } else {
                bridgeConfig.setCommandPrefix(bridgeId, newValue)
              }
            }
          },
          {
            type: OptionType.Label,
            name: 'Disabled Chat Commands',
            description: 'Commands disabled for this bridge. Use `!toggle` command to modify.',
            getOption: () => {
              const disabledCommands = bridgeConfig.getDisabledCommands(bridgeId)
              return disabledCommands.length === 0 ? 'none (using global)' : disabledCommands.join(', ')
            }
          },
          {
            type: OptionType.Text,
            name: 'Passthrough Prefix',
            description: 'Prefix for passthrough commands. Leave empty to use global prefix.',
            style: InputStyle.Tiny,
            min: 0,
            max: 2,
            getOption: () =>
              bridgeConfig.getPassthroughPrefix(bridgeId) ??
              application.core.commandsConfigurations.getPassthroughPrefix(),
            setOption: (newValue) => {
              if (newValue === '' || newValue === application.core.commandsConfigurations.getPassthroughPrefix()) {
                bridgeConfig.setPassthroughPrefix(bridgeId, undefined)
              } else {
                bridgeConfig.setPassthroughPrefix(bridgeId, newValue)
              }
            }
          },
          {
            type: OptionType.List,
            name: 'Passthrough Commands',
            description:
              'Commands sent directly to in-game chat for stat bots (e.g., bw, sw). ' +
              'Leave empty to use global settings. Enter without prefix.',
            style: InputStyle.Short,
            min: 0,
            max: 20,
            getOption: () => {
              const commands = bridgeConfig.getPassthroughCommands(bridgeId)
              return commands.length > 0 ? commands : application.core.commandsConfigurations.getPassthroughCommands()
            },
            setOption: (values: string[]) => {
              bridgeConfig.setPassthroughCommands(bridgeId, values)
            }
          }
        ]
      },
      // ========== AI Chatbot ==========
      {
        type: OptionType.Category,
        name: 'AI Chatbot',
        description: 'Configure the AI Chatbot plugin for this bridge',
        header: `**AI Chatbot for ${bridgeId}**\n\nConfigure whether the AI chat plugin is enabled for this specific bridge.`,
        options: [
          {
            type: OptionType.Boolean,
            name: 'Enable AI Chatbot',
            description: 'Enable or disable the AI chat plugin for this bridge.',
            getOption: () => bridgeConfig.getAiChatEnabled(bridgeId),
            toggleOption: () => {
              bridgeConfig.setAiChatEnabled(bridgeId, !bridgeConfig.getAiChatEnabled(bridgeId))
            }
          }
        ]
      },
      // ========== Rankup Automation ==========
      {
        type: OptionType.Category,
        name: 'Rankup Automation',
        description: 'Configure automatic promotion and demotion of guild members.',
        header: `**Rankup Automation for ${bridgeId}**\n\nAutomatically promote or demote members based on GEXP, time in guild, and online time.`,
        options: [
          {
            type: OptionType.Boolean,
            name: 'Enable Rankup Automation',
            description: 'Turn the automatic rankup system on or off.',
            getOption: () => bridgeConfig.getRankupEnabled(bridgeId),
            toggleOption: () => {
              bridgeConfig.setRankupEnabled(bridgeId, !bridgeConfig.getRankupEnabled(bridgeId))
            }
          },
          {
            type: OptionType.Boolean,
            name: 'Manual Review Mode',
            description: 'If enabled, officers must approve actions before they are executed.',
            getOption: () => bridgeConfig.getRankupManualReview(bridgeId),
            toggleOption: () => {
              bridgeConfig.setRankupManualReview(bridgeId, !bridgeConfig.getRankupManualReview(bridgeId))
            }
          },
          {
            type: OptionType.Number,
            name: 'Notification Cooldown (Hours)',
            description: 'Minimum hours between notification batches to avoid spam.',
            min: 1,
            max: 168, // 1 week
            getOption: () => bridgeConfig.getRankupNotificationCooldown(bridgeId),
            setOption: (value: number) => {
              bridgeConfig.setRankupNotificationCooldown(bridgeId, value)
            }
          },
          {
            type: OptionType.Channel,
            name: 'Rankup Notification Channels',
            description: 'Channels where rankup notifications and pending reviews are sent.',
            min: 0,
            max: 5,
            getOption: () => bridgeConfig.getRankupNotificationChannelIds(bridgeId),
            setOption: (values: string[]) => {
              bridgeConfig.setRankupNotificationChannelIds(bridgeId, values)
            }
          },
          {
            type: OptionType.Action,
            name: 'Run Rankup Check Now',
            description: 'Manually trigger the rankup check for this bridge.',
            label: 'Run Check',
            style: ButtonStyle.Primary,
            onInteraction: async (interaction: ButtonInteraction, errorHandler, helpers) => {
              void errorHandler
              void helpers
              await application.core.rankupManager.runTaskForBridge(bridgeId)
              await interaction.reply({
                content: 'Rankup check triggered for this bridge.',
                flags: MessageFlags.Ephemeral
              })
              return true
            }
          },
          // Promotion Rules - managed in subcategory
          {
            type: OptionType.Category,
            name: 'Promotion Rules',
            description: 'Configure rules for automatically promoting guild members.',
            header: `**Promotion Rules for ${bridgeId}**\n\nConfigure automatic promotion rules based on GEXP, time in guild, and online time.`,
            get options() {
              if (cachedPromotionOptions !== undefined) return cachedPromotionOptions

              cachedPromotionOptions = []
              const promoRules = bridgeConfig.getRankupRules(bridgeId)

              for (const [index, rule] of promoRules.entries()) {
                const targetRankOption: OptionItem =
                  guildRanks.length > 0
                    ? {
                        type: OptionType.PresetList,
                        name: 'Target Rank',
                        description: 'The rank to promote the member to.',
                        min: 1,
                        max: 1,
                        options: guildRanks.map((r) => ({ label: r, value: r })),
                        getOption: () => [bridgeConfig.getRankupRules(bridgeId)[index].targetRank],
                        setOption: (value) => {
                          const newRules = [...bridgeConfig.getRankupRules(bridgeId)]
                          newRules[index] = { ...newRules[index], targetRank: value[0] }
                          bridgeConfig.setRankupRules(bridgeId, newRules)
                          cachedPromotionOptions = undefined
                        }
                      }
                    : {
                        type: OptionType.Text,
                        name: 'Target Rank',
                        description: 'The rank to promote the member to.',
                        style: InputStyle.Short,
                        min: 1,
                        max: 32,
                        getOption: () => bridgeConfig.getRankupRules(bridgeId)[index].targetRank,
                        setOption: (value) => {
                          const newRules = [...bridgeConfig.getRankupRules(bridgeId)]
                          newRules[index] = { ...newRules[index], targetRank: value }
                          bridgeConfig.setRankupRules(bridgeId, newRules)
                          cachedPromotionOptions = undefined
                        }
                      }

                cachedPromotionOptions.push({
                  type: OptionType.Category,
                  name: `Rule #${index + 1}: ${rule.targetRank}`,
                  description: `Promote to ${rule.targetRank}`,
                  header: `**Promotion Rule #${index + 1}: ${rule.targetRank}**\n\nConfigure criteria for promoting members to ${rule.targetRank}.`,
                  options: [
                    targetRankOption,
                    {
                      type: OptionType.Number,
                      name: 'Minimum Weekly GEXP',
                      description: 'Minimum weekly GEXP required for this rank.',
                      min: 0,
                      max: 10_000_000,
                      getOption: () => bridgeConfig.getRankupRules(bridgeId)[index]?.minWeeklyGexp ?? 0,
                      setOption: (value: number) => {
                        const newRules = [...bridgeConfig.getRankupRules(bridgeId)]
                        newRules[index] = { ...newRules[index], minWeeklyGexp: value }
                        bridgeConfig.setRankupRules(bridgeId, newRules)
                        cachedPromotionOptions = undefined
                      }
                    },
                    {
                      type: OptionType.Number,
                      name: 'Minimum Days in Guild',
                      description: 'Minimum days the member must have been in the guild.',
                      min: 0,
                      max: 3650,
                      getOption: () => bridgeConfig.getRankupRules(bridgeId)[index]?.minDaysInGuild ?? 0,
                      setOption: (value: number) => {
                        const newRules = [...bridgeConfig.getRankupRules(bridgeId)]
                        newRules[index] = { ...newRules[index], minDaysInGuild: value }
                        bridgeConfig.setRankupRules(bridgeId, newRules)
                        cachedPromotionOptions = undefined
                      }
                    },
                    {
                      type: OptionType.Number,
                      name: 'Minimum Online Hours',
                      description: 'Minimum hours online.',
                      min: 0,
                      max: 100_000,
                      getOption: () => bridgeConfig.getRankupRules(bridgeId)[index]?.minOnlineHours ?? 0,
                      setOption: (value: number) => {
                        const newRules = [...bridgeConfig.getRankupRules(bridgeId)]
                        newRules[index] = { ...newRules[index], minOnlineHours: value }
                        bridgeConfig.setRankupRules(bridgeId, newRules)
                        cachedPromotionOptions = undefined
                      }
                    },
                    {
                      type: OptionType.Action,
                      name: 'Delete Rule',
                      label: 'Delete',
                      style: ButtonStyle.Danger,
                      onInteraction: async (interaction, errorHandler, helpers) => {
                        void errorHandler
                        void helpers
                        const previous = bridgeConfig.getRankupRules(bridgeId)
                        // #region agent log
                        debugSessionLog({
                          hypothesisId: 'H6',
                          location: 'settings.ts:promotion:deleteRule',
                          message: 'Delete promotion rule',
                          data: { bridgeId, index, prevLen: previous.length }
                        })
                        // #endregion
                        const newRules = [...previous]
                        newRules.splice(index, 1)
                        bridgeConfig.setRankupRules(bridgeId, newRules)
                        cachedPromotionOptions = undefined
                        await interaction.reply({
                          content: 'Rule deleted.',
                          flags: MessageFlags.Ephemeral
                        })
                        return true
                      }
                    }
                  ]
                })
              }

              cachedPromotionOptions.push({
                type: OptionType.Action,
                name: 'Add Promotion Rule',
                label: 'Add Rule',
                style: ButtonStyle.Success,
                onInteraction: async (interaction: ButtonInteraction, errorHandler, helpers) => {
                  void errorHandler
                  void helpers
                  const newRules = [...bridgeConfig.getRankupRules(bridgeId)]
                  newRules.push({
                    targetRank: guildRanks.length > 0 ? guildRanks[0] : 'Member',
                    minWeeklyGexp: 0,
                    minDaysInGuild: 0,
                    minOnlineHours: 0
                  })
                  bridgeConfig.setRankupRules(bridgeId, newRules)
                  cachedPromotionOptions = undefined
                  await interaction.reply({
                    content: 'New promotion rule added.',
                    flags: MessageFlags.Ephemeral
                  })
                  return true
                }
              })

              return cachedPromotionOptions
            }
          },
          // Demotion Rules - managed in subcategory
          {
            type: OptionType.Category,
            name: 'Demotion Rules',
            description: 'Configure rules for automatically demoting or kicking guild members.',
            header: `**Demotion Rules for ${bridgeId}**\n\nConfigure automatic demotion/kick rules based on GEXP and other criteria.`,
            get options() {
              if (cachedDemotionOptions !== undefined) return cachedDemotionOptions

              cachedDemotionOptions = []
              const demoRules = bridgeConfig.getRankupDemotionRules(bridgeId)
              // #region agent log
              debugSessionLog({
                hypothesisId: 'H5',
                location: 'settings.ts:demotionRules:getOptions:cacheMiss',
                message: 'Demotion rules options rebuilt from config',
                data: {
                  bridgeId,
                  ruleCount: demoRules.length,
                  rules: demoRules.map((r) => ({
                    fromRank: r.fromRank,
                    action: r.action,
                    targetRank: r.targetRank,
                    maxWeeklyGexp: r.maxWeeklyGexp,
                    gracePeriod: r.gracePeriod
                  }))
                }
              })
              // #endregion

              for (const [index, rule] of demoRules.entries()) {
                const fromRankOption: OptionItem =
                  guildRanks.length > 0
                    ? {
                        type: OptionType.PresetList,
                        name: 'From Rank',
                        description: 'The rank to evaluate for demotion.',
                        min: 1,
                        max: 1,
                        options: guildRanks.map((r) => ({ label: r, value: r })),
                        getOption: () => [bridgeConfig.getRankupDemotionRules(bridgeId)[index].fromRank],
                        setOption: (value) => {
                          const newRules = [...bridgeConfig.getRankupDemotionRules(bridgeId)]
                          newRules[index] = { ...newRules[index], fromRank: value[0] }
                          bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                          cachedDemotionOptions = undefined
                        }
                      }
                    : {
                        type: OptionType.Text,
                        name: 'From Rank',
                        description: 'The rank to evaluate for demotion.',
                        style: InputStyle.Short,
                        min: 1,
                        max: 32,
                        getOption: () => bridgeConfig.getRankupDemotionRules(bridgeId)[index].fromRank,
                        setOption: (value) => {
                          const newRules = [...bridgeConfig.getRankupDemotionRules(bridgeId)]
                          newRules[index] = { ...newRules[index], fromRank: value }
                          bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                          cachedDemotionOptions = undefined
                        }
                      }

                const targetRankDemotionOption: OptionItem[] =
                  rule.action === 'demote'
                    ? [
                        guildRanks.length > 0
                          ? {
                              type: OptionType.PresetList,
                              name: 'Target Rank',
                              description: 'The rank to demote to.',
                              min: 1,
                              max: 1,
                              options: guildRanks.map((r) => ({ label: r, value: r })),
                              getOption: () => [bridgeConfig.getRankupDemotionRules(bridgeId)[index].targetRank ?? ''],
                              setOption: (value) => {
                                const previous = bridgeConfig.getRankupDemotionRules(bridgeId)
                                const targetRank = value[0]
                                // #region agent log
                                debugSessionLog({
                                  hypothesisId: 'H5',
                                  location: 'settings.ts:demotion:targetRank:setOption',
                                  message: 'Demotion targetRank set',
                                  data: {
                                    bridgeId,
                                    index,
                                    prevTarget: previous[index]?.targetRank,
                                    nextTarget: targetRank
                                  }
                                })
                                // #endregion
                                const newRules = [...previous]
                                newRules[index] = {
                                  ...newRules[index],
                                  targetRank
                                }
                                bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                                cachedDemotionOptions = undefined
                              }
                            }
                          : {
                              type: OptionType.Text,
                              name: 'Target Rank',
                              description: 'The rank to demote to.',
                              style: InputStyle.Short,
                              min: 1,
                              max: 32,
                              getOption: () => bridgeConfig.getRankupDemotionRules(bridgeId)[index].targetRank ?? '',
                              setOption: (value) => {
                                const previous = bridgeConfig.getRankupDemotionRules(bridgeId)
                                const targetRank = value
                                // #region agent log
                                debugSessionLog({
                                  hypothesisId: 'H5',
                                  location: 'settings.ts:demotion:targetRank:setOption',
                                  message: 'Demotion targetRank set',
                                  data: {
                                    bridgeId,
                                    index,
                                    prevTarget: previous[index]?.targetRank,
                                    nextTarget: targetRank
                                  }
                                })
                                // #endregion
                                const newRules = [...previous]
                                newRules[index] = {
                                  ...newRules[index],
                                  targetRank
                                }
                                bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                                cachedDemotionOptions = undefined
                              }
                            }
                      ]
                    : []

                cachedDemotionOptions.push({
                  type: OptionType.Category,
                  name: `Rule #${index + 1}: ${rule.fromRank}`,
                  description: `${rule.action === 'kick' ? 'Kick' : 'Demote'} from ${rule.fromRank}`,
                  header: `**Demotion Rule #${index + 1}: ${rule.fromRank}**\n\nConfigure criteria for ${rule.action === 'kick' ? 'kicking' : 'demoting from'} ${rule.fromRank}.`,
                  options: [
                    fromRankOption,
                    {
                      type: OptionType.PresetList,
                      name: 'Action',
                      description: 'What to do if criteria are met.',
                      min: 1,
                      max: 1,
                      options: [
                        { label: 'Demote', value: 'demote' },
                        { label: 'Kick', value: 'kick' },
                        { label: 'Notify Only', value: 'notify' }
                      ],
                      getOption: () => [bridgeConfig.getRankupDemotionRules(bridgeId)[index]?.action ?? 'demote'],
                      setOption: (value: string[]) => {
                        const newRules = [...bridgeConfig.getRankupDemotionRules(bridgeId)]
                        const action = value[0]
                        if (action !== 'demote' && action !== 'kick' && action !== 'notify') {
                          return
                        }
                        newRules[index] = {
                          ...newRules[index],
                          action
                        }
                        bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                        cachedDemotionOptions = undefined
                      }
                    },
                    ...targetRankDemotionOption,
                    {
                      type: OptionType.Number,
                      name: 'Maximum Weekly GEXP',
                      description: 'Demote if GEXP is below this amount.',
                      min: 0,
                      max: 10_000_000,
                      getOption: () => bridgeConfig.getRankupDemotionRules(bridgeId)[index]?.maxWeeklyGexp ?? 0,
                      setOption: (value: number) => {
                        const previous = bridgeConfig.getRankupDemotionRules(bridgeId)
                        // #region agent log
                        debugSessionLog({
                          hypothesisId: 'H4_H5',
                          location: 'settings.ts:demotion:maxWeeklyGexp:setOption',
                          message: 'Demotion maxWeeklyGexp set',
                          data: {
                            bridgeId,
                            index,
                            prevMax: previous[index]?.maxWeeklyGexp,
                            nextVal: value,
                            prevRulesLen: previous.length
                          }
                        })
                        // #endregion
                        const newRules = [...previous]
                        newRules[index] = { ...newRules[index], maxWeeklyGexp: value }
                        bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                        cachedDemotionOptions = undefined
                      }
                    },
                    {
                      type: OptionType.Number,
                      name: 'Grace Period (Days)',
                      description: 'Days before demotion applies (e.g. for new members).',
                      min: 0,
                      max: 365,
                      getOption: () => bridgeConfig.getRankupDemotionRules(bridgeId)[index]?.gracePeriod ?? 0,
                      setOption: (value: number) => {
                        const newRules = [...bridgeConfig.getRankupDemotionRules(bridgeId)]
                        newRules[index] = { ...newRules[index], gracePeriod: value }
                        bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                        cachedDemotionOptions = undefined
                      }
                    },
                    {
                      type: OptionType.Action,
                      name: 'Delete Rule',
                      label: 'Delete',
                      style: ButtonStyle.Danger,
                      onInteraction: async (interaction: ButtonInteraction, errorHandler, helpers) => {
                        void errorHandler
                        void helpers
                        const previous = bridgeConfig.getRankupDemotionRules(bridgeId)
                        // #region agent log
                        debugSessionLog({
                          hypothesisId: 'H6',
                          location: 'settings.ts:demotion:deleteRule',
                          message: 'Delete demotion rule',
                          data: { bridgeId, index, prevLen: previous.length }
                        })
                        // #endregion
                        const newRules = [...previous]
                        newRules.splice(index, 1)
                        bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                        cachedDemotionOptions = undefined
                        await interaction.reply({
                          content: 'Rule deleted.',
                          flags: MessageFlags.Ephemeral
                        })
                        return true
                      }
                    }
                  ]
                })
              }

              cachedDemotionOptions.push({
                type: OptionType.Action,
                name: 'Add Demotion Rule',
                label: 'Add Rule',
                style: ButtonStyle.Success,
                onInteraction: async (interaction: ButtonInteraction, errorHandler, helpers) => {
                  void errorHandler
                  void helpers
                  const previous = bridgeConfig.getRankupDemotionRules(bridgeId)
                  const newRules = [...previous]
                  newRules.push({
                    fromRank: guildRanks.length > 0 ? guildRanks[0] : 'Member',
                    action: 'demote' as const,
                    targetRank: guildRanks.length > 0 ? guildRanks[0] : 'Member',
                    maxWeeklyGexp: 0,
                    gracePeriod: 0
                  })
                  // #region agent log
                  debugSessionLog({
                    hypothesisId: 'H4',
                    location: 'settings.ts:demotion:addRule',
                    message: 'Add demotion rule',
                    data: { bridgeId, prevLen: previous.length, nextLen: newRules.length }
                  })
                  // #endregion
                  bridgeConfig.setRankupDemotionRules(bridgeId, newRules)
                  cachedDemotionOptions = undefined
                  await interaction.reply({
                    content: 'New demotion rule added.',
                    flags: MessageFlags.Ephemeral
                  })
                  return true
                }
              })

              return cachedDemotionOptions
            }
          },
          ...(guildRanks.length > 0
            ? [
                {
                  type: OptionType.PresetList,
                  name: 'Excluded Ranks',
                  description:
                    'Ranks that should never be touched by the auto-rankup system (e.g. Guild Master, Officer).',
                  options: guildRanks.map((r) => ({ label: r, value: r })),
                  min: 0,
                  max: guildRanks.length,
                  getOption: () => bridgeConfig.getRankupExcludedRanks(bridgeId),
                  setOption: (values: string[]) => {
                    bridgeConfig.setRankupExcludedRanks(bridgeId, values)
                  }
                } satisfies OptionItem
              ]
            : [
                {
                  type: OptionType.List,
                  name: 'Excluded Ranks',
                  description:
                    'Ranks that should never be touched by the auto-rankup system (e.g. Guild Master, Officer).',
                  style: InputStyle.Short,
                  min: 0,
                  max: 20,
                  getOption: () => bridgeConfig.getRankupExcludedRanks(bridgeId),
                  setOption: (values: string[]) => {
                    bridgeConfig.setRankupExcludedRanks(bridgeId, values)
                  }
                } satisfies OptionItem
              ]),
          {
            type: OptionType.List,
            name: 'Excluded Players',
            description: 'Usernames of players to exclude from all checks.',
            style: InputStyle.Short,
            min: 0,
            max: 50,
            getOption: () => bridgeConfig.getRankupExcludedPlayers(bridgeId),
            setOption: (values: string[]) => {
              bridgeConfig.setRankupExcludedPlayers(bridgeId, values)
            }
          }
        ]
      },
      // ========== Danger Zone ==========
      {
        type: OptionType.Category,
        name: 'Danger Zone',
        description: 'Destructive actions for this bridge',
        header: `**⚠️ Danger Zone for ${bridgeId}**\n\nThese actions cannot be undone!`,
        options: [
          {
            type: OptionType.Action,
            name: `Delete Bridge`,
            description: `Permanently delete bridge "${bridgeId}" and all its configurations.`,
            label: 'delete',
            style: ButtonStyle.Danger,
            onInteraction: async (interaction, errorHandler, helpers) => {
              void errorHandler
              void helpers
              bridgeConfig.removeBridgeId(bridgeId)
              application.bridgeResolver.rebuildLookupMaps()

              // Remove this bridge from the options list
              const indexToRemove = bridgeSubOptions.findIndex(
                (opt) => opt.type === OptionType.Category && opt.name === `Bridge: ${bridgeId}`
              )
              if (indexToRemove !== -1) {
                bridgeSubOptions.splice(indexToRemove, 1)
              }

              await interaction.reply({
                embeds: [
                  {
                    title: 'Bridge Deleted',
                    description: `Bridge \`${escapeMarkdown(bridgeId)}\` has been deleted.`,
                    color: Color.Good,
                    footer: { text: DefaultCommandFooter }
                  }
                ],
                flags: MessageFlags.Ephemeral
              })
              return true
            }
          }
        ]
      }
    ]
  }
}

async function fetchBridgeOptions(application: Application, context: DiscordCommandContext): Promise<CategoryOption> {
  const bridgeConfig = application.core.bridgeConfigurations

  // Generate options for each existing bridge
  const bridgeSubOptions: CategoryOption['options'] = []

  // Add option to create a new bridge (Global Admin only)
  if (context.permission === Permission.Admin) {
    bridgeSubOptions.push({
      type: OptionType.Action,
      name: 'Create New Bridge',
      description: 'Create a new bridge to connect Minecraft instances to specific Discord channels.',
      label: 'create',
      style: ButtonStyle.Success,
      onInteraction: async (interaction, errorHandler, helpers) => {
        void errorHandler
        void helpers
        await interaction.showModal({
          customId: 'bridge-create',
          title: 'Create New Bridge',
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.TextInput,
                  customId: 'bridge-id',
                  style: TextInputStyle.Short,
                  label: 'Bridge ID (unique identifier)',
                  placeholder: 'e.g. guild1, main-guild, etc.',
                  minLength: 1,
                  maxLength: 32,
                  required: true
                }
              ]
            }
          ]
        })

        const modalInteraction = await interaction.awaitModalSubmit({
          time: 300_000,
          filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id
        })

        const bridgeId = modalInteraction.fields.getTextInputValue('bridge-id').trim().toLowerCase()

        // Check if bridge already exists
        const existingBridges = bridgeConfig.getAllBridgeIds()
        if (existingBridges.includes(bridgeId)) {
          await modalInteraction.reply({
            embeds: [
              {
                title: 'Bridge Creation Failed',
                description: `A bridge with ID \`${escapeMarkdown(bridgeId)}\` already exists.`,
                color: Color.Error,
                footer: { text: DefaultCommandFooter }
              }
            ],
            flags: MessageFlags.Ephemeral
          })
          return true
        }

        bridgeConfig.addBridgeId(bridgeId)
        application.bridgeResolver.rebuildLookupMaps()

        // Dynamically add the new bridge option to the options list
        const newBridgeOption = await createBridgeOption(application, bridgeId, bridgeSubOptions)
        bridgeSubOptions.push(newBridgeOption)

        await modalInteraction.reply({
          embeds: [
            {
              title: 'Bridge Created',
              description:
                `Bridge \`${escapeMarkdown(bridgeId)}\` has been created.\n\n` +
                `**Next steps:**\n` +
                `1. Go back to Settings → Bridges → ${bridgeId}\n` +
                `2. Set the Public and Officer channels\n` +
                `3. Add Minecraft instance names to the bridge`,
              color: Color.Good,
              footer: { text: DefaultCommandFooter }
            }
          ],
          flags: MessageFlags.Ephemeral
        })
        return true
      }
    })
  }

  // Add existing bridges as sub-options
  const existingBridges = bridgeConfig.getAllBridgeIds()
  for (const bridgeId of existingBridges) {
    // Only show the bridge the command was run in, or all bridges if global admin
    if (context.permission === Permission.Admin || bridgeId === context.bridgeId) {
      bridgeSubOptions.push(await createBridgeOption(application, bridgeId, bridgeSubOptions))
    }
  }

  return {
    type: OptionType.Category,
    name: 'Bridges (Multi-Guild)',
    get header() {
      const currentBridges = bridgeConfig.getAllBridgeIds()
      return (
        '**Multi-Guild Bridge Configuration**\n\n' +
        'Bridges allow you to run multiple isolated guild chats within a single application.\n' +
        'Each bridge connects specific Minecraft instances to specific Discord channels.\n\n' +
        'Messages from a Minecraft instance will only be sent to channels in the same bridge.\n' +
        'Messages from a Discord channel will only be sent to Minecraft instances in the same bridge.\n\n' +
        `**Currently configured bridges:** ${currentBridges.length === 0 ? 'None (using legacy single-guild mode)' : currentBridges.join(', ')}`
      )
    },
    options: bridgeSubOptions
  }
}

function fetchModerationOptions(application: Application): CategoryOption {
  const moderation = application.core.moderationConfiguration

  return {
    type: OptionType.Category,
    name: 'Moderation',
    header: CategoryLabel,
    options: [
      {
        type: OptionType.EmbedCategory,
        name: `Heat Punishments`,
        options: [
          {
            type: OptionType.Boolean,
            name: `Enable Heat Punishment ${Essential}`,
            description: 'Enable to set limits to the amount of actions staff can take before being blocked.',
            getOption: () => moderation.getHeatPunishment(),
            toggleOption: () => {
              moderation.setHeatPunishment(!moderation.getHeatPunishment())
            }
          },
          {
            type: OptionType.Number,
            name: 'Kicks Per Day',
            description: 'Allowed kicks per Day for staff before they are blocked from doing any more.',

            min: 0,
            max: 100,
            getOption: () => moderation.getKicksPerDay(),
            setOption: (value) => {
              moderation.setKicksPerDay(value)
            }
          },
          {
            type: OptionType.Number,
            name: 'Mutes Per Day',
            description: 'Allowed mutes per Day for staff before they are blocked from doing any more.',

            min: 0,
            max: 100,
            getOption: () => moderation.getMutesPerDay(),
            setOption: (value) => {
              moderation.setMutesPerDay(value)
            }
          }
        ]
      },
      {
        type: OptionType.EmbedCategory,
        name: 'Immunity List',
        description: 'Users who are completely immune to heat punishments (Use at your own risk!)',
        options: [
          {
            type: OptionType.User,
            name: 'Immune Discord Users',
            min: 0,
            max: 10,
            getOption: () => moderation.getImmuneDiscordUsers(),
            setOption: (values) => {
              moderation.setImmuneDiscordUsers(values)
            }
          },
          {
            type: OptionType.List,
            name: 'Immune Mojang Players',
            style: InputStyle.Short,
            min: 0,
            max: 10,
            getOption: () => moderation.getImmuneMojangPlayers(),
            setOption: (values) => {
              moderation.setImmuneMojangPlayers(values)
            }
          }
        ]
      },
      {
        type: OptionType.EmbedCategory,
        name: `Profanity Filter`,
        options: [
          {
            type: OptionType.Boolean,
            name: `Profanity Filter ${Essential}`,
            description: 'Enable to filter and censor chat messages for profanity.',
            getOption: () => moderation.getProfanityEnabled(),
            toggleOption: () => {
              moderation.setProfanityEnabled(!moderation.getProfanityEnabled())
            }
          },
          {
            type: OptionType.Label,
            name: 'Profanity List',
            description: 'Use command `/profanity` to edit the filter.',
            getOption: undefined
          }
        ]
      }
    ]
  }
}

function fetchQualityOptions(application: Application): CategoryOption {
  const events = application.core.spontaneousEventsConfigurations
  const plugins = application.core.applicationConfigurations
  const minecraft = application.core.minecraftConfigurations

  return {
    type: OptionType.Category,
    name: 'Quality Of Life',
    header: CategoryLabel,
    options: [
      {
        type: OptionType.Category,
        name: 'Quick Chat Events',
        description: 'Automatically start an interactive chat event when there is enough activity.',
        header: CategoryLabel,
        options: [
          {
            type: OptionType.Boolean,
            name: 'Enable Quick Chat Events',
            description: 'Control whether the feature is active.',
            getOption: () => events.getEnabled(),
            toggleOption: () => {
              events.setEnabled(!events.getEnabled())
            }
          },
          {
            type: OptionType.Number,
            name: 'Cooldown Between Events',
            description: 'How long to wait before another event starts (in minutes).',
            min: 1,
            max: 1440,
            getOption: () => {
              return Math.ceil(events.getCooldownDuration().toMinutes())
            },
            setOption: (value) => {
              events.setCooldownDuration(Duration.minutes(value))
            }
          },
          {
            type: OptionType.PresetList,
            name: 'Allowed Events',
            description: 'What type of events are allowed to start.',
            min: 0,
            max: Object.values(SpontaneousEventsNames).length,
            options: [
              {
                label: 'Quick Math',
                value: SpontaneousEventsNames.QuickMath,
                description: 'Create a math question and the fastest who can answer wins.'
              },
              {
                label: 'Counting Chain',
                value: SpontaneousEventsNames.CountingChain,
                description: 'Create a counting chain where the before last person to stop gets muted for 5 minutes.'
              },
              {
                label: 'Unscramble',
                value: SpontaneousEventsNames.Unscramble,
                description: 'A word is scrambled and the fastest who can answer wins.'
              },
              {
                label: 'Trivia',
                value: SpontaneousEventsNames.Trivia,
                description: 'Ask a trivia with options answers. Answer is later revealed.'
              }
            ],
            getOption: () => events.getEnabledEvents(),
            setOption: (values) => {
              events.setEnabledEvents(values as SpontaneousEventsNames[])
            }
          },
          {
            type: OptionType.EmbedCategory,
            name: 'Advanced Options',
            description:
              'Control When To Start An Event. ' +
              'Only change these if you **REALLY know what you are doing**! ' +
              'All conditions must be met before an event starts.',
            options: [
              {
                type: OptionType.Number,
                name: 'Activity Duration',
                description:
                  'How long should the chat be active before it is considered active enough for an event (in minutes).',
                min: 1,
                max: 312_480,
                getOption: () => {
                  return Math.ceil(events.getActivityDuration().toMinutes())
                },
                setOption: (value) => {
                  events.setActivityDuration(Duration.minutes(value))
                }
              },
              {
                type: OptionType.Number,
                name: 'Minimum Active Users',
                description: 'How many users must be active in chat to start an event.',
                min: 1,
                max: 100,
                getOption: () => {
                  return events.getMinimumUsers()
                },
                setOption: (value) => {
                  events.setMinimumUsers(value)
                }
              },
              {
                type: OptionType.Number,
                name: 'Minimum Sent Messages',
                description: 'How many messages must be sent in chat before starting an event.',
                min: 5,
                max: 10_000,
                getOption: () => {
                  return events.getMinimumMessages()
                },
                setOption: (value) => {
                  events.setMinimumMessages(value)
                }
              }
            ]
          }
        ]
      },
      {
        type: OptionType.Boolean,
        name: 'Darkauction Reminder',
        description: 'Send a reminder when a skyblock dark auction is starting.',
        getOption: () => plugins.getDarkAuctionReminder(),
        toggleOption: () => {
          plugins.setDarkAuctionReminder(!plugins.getDarkAuctionReminder())
        }
      },
      {
        type: OptionType.Boolean,
        name: 'Starfall Cult Reminder',
        description: 'Send a reminder when the skyblock starfall cult gathers.',
        getOption: () => plugins.getStarfallCultReminder(),
        toggleOption: () => {
          plugins.setStarfallCultReminder(!plugins.getStarfallCultReminder())
        }
      },
      {
        type: OptionType.Boolean,
        name: 'Announce Player Muted',
        description:
          'Announce to the guild about a player being muted when they send `/immuted` to the application in-game.',
        getOption: () => minecraft.getAnnounceMutedPlayer(),
        toggleOption: () => {
          minecraft.setAnnounceMutedPlayer(!minecraft.getAnnounceMutedPlayer())
        }
      },
      {
        type: OptionType.EmbedCategory,
        name: 'Guild Reaction',
        description: 'Auto replying and reacting to various in-game guild events.',
        options: [
          {
            type: OptionType.Boolean,
            name: 'Guild Join Reaction',
            description: 'Send a greeting message when a member joins the guild.',
            getOption: () => minecraft.getJoinGuildReaction(),
            toggleOption: () => {
              minecraft.setJoinGuildReaction(!minecraft.getJoinGuildReaction())
            }
          },
          {
            type: OptionType.Boolean,
            name: 'Guild Leave Reaction',
            description: 'Send a reaction message when a member leaves the guild.',
            getOption: () => minecraft.getLeaveGuildReaction(),
            toggleOption: () => {
              minecraft.setLeaveGuildReaction(!minecraft.getLeaveGuildReaction())
            }
          },
          {
            type: OptionType.Boolean,
            name: 'Guild Kick Reaction',
            description: 'Send a reaction message when a member is kicked from the guild.',
            getOption: () => minecraft.getKickGuildReaction(),
            toggleOption: () => {
              minecraft.setKickGuildReaction(!minecraft.getKickGuildReaction())
            }
          }
        ]
      }
    ]
  }
}

function fetchDiscordOptions(application: Application): CategoryOption {
  const discord = application.core.discordConfigurations
  const deleterConfig = application.core.discordConfigurations

  return {
    type: OptionType.Category,
    name: 'Discord',
    header: CategoryLabel,
    options: [
      {
        type: OptionType.Channel,

        name: `Public Channels ${Essential}`,
        description: 'Manage public channels',

        min: 0,
        max: 5,

        getOption: () => discord.getPublicChannelIds(),
        setOption: (values) => {
          discord.setPublicChannelIds(values)
        }
      },
      {
        type: OptionType.Boolean,
        name: 'Always Reply',
        description:
          'Enable to always send a text reply instead of reactions when a problem occurs. E.g when a message is blocked',
        getOption: () => discord.getAlwaysReplyReaction(),
        toggleOption: () => {
          discord.setAlwaysReplyReaction(!discord.getAlwaysReplyReaction())
        }
      },
      {
        type: OptionType.Boolean,
        name: 'Enforce Verification',
        description: 'Enable to always require verification via `/verify` to chat using the application.',
        getOption: () => discord.getEnforceVerification(),
        toggleOption: () => {
          discord.setEnforceVerification(!discord.getEnforceVerification())
        }
      },
      {
        type: OptionType.Boolean,
        name: 'Minecraft Text Images',
        description:
          'Render chat messages the same way they are rendered in Minecraft in-game. **DOES NOT WORK ON WINDOWS OS.**',
        getOption: () => discord.getTextToImage(),
        toggleOption: () => {
          discord.setTextToImage(!discord.getTextToImage())
        }
      },
      {
        type: OptionType.Category,
        name: 'Minecraft Events',
        description: 'Advanced options for fine tuning public chat channels.',
        header:
          '**These events are recommended for best user experience.**\n' +
          'Do not turn off unless you know what you are doing.\n\n' +
          CategoryLabel,
        options: [
          {
            type: OptionType.Boolean,
            name: `Member Online ${Recommended}`,
            description:
              'Show a temporary message in the designated public discord channels when a guild member comes online.',
            getOption: () => discord.getGuildOnline(),
            toggleOption: () => {
              discord.setGuildOnline(!discord.getGuildOnline())
            }
          },
          {
            type: OptionType.Boolean,
            name: `Member Offline ${Recommended}`,
            description:
              'Show a temporary message in the designated public discord channels when a guild member goes offline.',
            getOption: () => discord.getGuildOffline(),
            toggleOption: () => {
              discord.setGuildOffline(!discord.getGuildOffline())
            }
          },
          {
            type: OptionType.Number,
            name: 'Delete Temporary Events After (In Seconds)',
            description: 'Temporary events are `Online` and `Offline` events.',
            min: 1,
            max: 43_200,
            getOption: () => deleterConfig.getDurationTemporarilyInteractions().toSeconds(),
            setOption: (value) => {
              deleterConfig.setDurationTemporarilyInteractions(Duration.seconds(value))
            }
          },
          {
            type: OptionType.Number,
            name: 'Max Temporarily Events',
            description: 'How many to keep in a channel before starting to delete the older ones.',
            min: 1,
            max: 1000,
            getOption: () => deleterConfig.getMaxTemporarilyInteractions(),
            setOption: (value) => {
              deleterConfig.setMaxTemporarilyInteractions(value)
            }
          }
        ]
      },
      {
        type: OptionType.Category,
        name: 'Staff Options',
        description: 'Assign staff channels and roles, so the application can integrate with them.',
        header: 'These are dangerous permissions. Make sure you know what you are doing!',
        options: [
          {
            type: OptionType.Channel,

            name: 'Officer Channels',
            description: 'Manage officer channels',

            min: 0,
            max: 5,

            getOption: () => discord.getOfficerChannelIds(),
            setOption: (values) => {
              discord.setOfficerChannelIds(values)
            }
          },
          {
            type: OptionType.Channel,

            name: 'Logs Channels',
            description: 'Channels where application logs are sent. This is for staff only!',

            min: 0,
            max: 5,

            getOption: () => discord.getLoggerChannelIds(),
            setOption: (values) => {
              discord.setLoggerChannelIds(values)
            }
          },
          {
            type: OptionType.Role,

            name: 'Helper Roles',
            description: 'Staff roles that have permissions to execute commands such as `!toggle` and `/invite`',

            min: 0,
            max: 5,

            getOption: () => discord.getHelperRoleIds(),
            setOption: (values) => {
              discord.setHelperRoleIds(values)
            }
          },
          {
            type: OptionType.Role,

            name: 'Owner Roles',
            description: 'Staff roles that have access to destructive commands like `/ban` and `/kick`.',

            min: 0,
            max: 5,

            getOption: () => discord.getOwnerRoleIds(),
            setOption: (values) => {
              discord.setOwnerRoleIds(values)
            }
          },
          {
            type: OptionType.Role,

            name: 'Officer Roles',
            description:
              'Staff roles that have permissions to execute non-destructive moderation commands like `/punishments mute`.',

            min: 0,
            max: 5,

            getOption: () => discord.getOfficerRoleIds(),
            setOption: (values) => {
              discord.setOfficerRoleIds(values)
            }
          }
        ]
      }
    ]
  }
}

function fetchCommandsOptions(application: Application): CategoryOption {
  const minecraft = application.core.minecraftConfigurations
  const commands = application.core.commandsConfigurations

  return {
    type: OptionType.Category,
    name: 'Chat Commands',
    header: CategoryLabel,
    options: [
      {
        type: OptionType.Boolean,
        name: `Enable Chat Commands ${Recommended}`,
        description: 'Enable commands such as `!cata` and `!iq`',
        getOption: () => commands.getCommandsEnabled(),
        toggleOption: () => {
          commands.setCommandsEnabled(!commands.getCommandsEnabled())
        }
      },
      {
        type: OptionType.Boolean,
        name: `Explain Commands on Help ${Recommended}`,
        description: 'Provide detailed explanations when users type `!<command> help`',
        getOption: () => commands.getExplainCommandOnHelp(),
        toggleOption: () => {
          commands.setExplainCommandOnHelp(!commands.getExplainCommandOnHelp())
        }
      },
      {
        type: OptionType.Boolean,
        name: `Suggest on Typo ${Recommended}`,
        description: 'Suggest similar commands when users type an unknown command',
        getOption: () => commands.getSuggestOnTypo(),
        toggleOption: () => {
          commands.setSuggestOnTypo(!commands.getSuggestOnTypo())
        }
      },
      {
        type: OptionType.Text,
        name: 'Chat Command Prefix',
        description: 'Prefix to indicate it is a chat command.',
        style: InputStyle.Tiny,
        min: 1,
        max: 2, // to allow "b!" prefix for example at most
        getOption: () => commands.getChatPrefix(),
        setOption: (newValue) => {
          commands.setChatPrefix(newValue)
        }
      },
      {
        type: OptionType.Label,
        name: 'Admin Username',
        description: 'You can change admin username from **Minecraft** category.',
        getOption: () => minecraft.getAdminUsername()
      },
      {
        type: OptionType.Label,
        name: 'Disabled Chat Commands',
        description: 'This can only be changed via `!toggle`.',
        getOption: () => {
          const disabledCommands = commands.getDisabledCommands()
          return disabledCommands.length === 0 ? 'none' : disabledCommands.join(', ')
        }
      },
      {
        type: OptionType.Text,
        name: 'Passthrough Prefix',
        description: 'Prefix for passthrough commands (commands sent directly to in-game chat for stat bots).',
        style: InputStyle.Tiny,
        min: 1,
        max: 2,
        getOption: () => commands.getPassthroughPrefix(),
        setOption: (newValue) => {
          commands.setPassthroughPrefix(newValue)
        }
      },
      {
        type: OptionType.List,
        name: 'Passthrough Commands',
        description:
          'Commands that are sent directly to in-game guild chat without bridge formatting. ' +
          'Useful for triggering in-game stat bots (e.g., `bw`, `sw`, `cata`). ' +
          'Enter command names without prefix (one per line).',
        style: InputStyle.Short,
        min: 1,
        max: 20,
        getOption: () => commands.getPassthroughCommands(),
        setOption: (values: string[]) => {
          commands.setPassthroughCommands(values)
        }
      }
    ]
  }
}

function fetchLanguageOptions(application: Application): CategoryOption {
  const language = application.core.languageConfigurations

  return {
    type: OptionType.Category,
    name: 'Language',
    header: CategoryLabel,
    options: [
      {
        type: OptionType.PresetList,
        name: 'Application Language',
        description:
          'Change application entire language from chat commands (e.g. `!iq`)' +
          ' to staff moderation tools and everything in between. ' +
          '**This menu will stay in the default language.**',
        min: 1,
        max: 1,
        getOption: () => [language.getLanguage()],
        setOption: (values) => {
          const selected = values[0] as ApplicationLanguages
          assert.notStrictEqual(selected, undefined)
          assert.ok(Object.values(ApplicationLanguages).includes(selected))

          application.changeLanguage(selected)
        },
        options: Object.entries(ApplicationLanguages).map(([key, value]) => ({ label: key, value: value }))
      },
      {
        type: OptionType.EmbedCategory,
        name: 'Change Text',
        description: 'Fine tune application by manually changing various texts23.- and messages.',
        options: [
          {
            type: OptionType.Text,
            name: 'Announce Player Muted',
            description:
              'Announce to the guild about a player being muted when they send `/immuted` to the application in-game.',
            style: InputStyle.Long,
            min: 2,
            max: 150,
            getOption: () => language.getAnnounceMutedPlayer(),
            setOption: (value) => {
              language.setAnnounceMutedPlayer(value)
            }
          },
          {
            type: OptionType.Category,
            name: 'Automated Messages',
            options: [
              {
                type: OptionType.Text,
                name: 'Dark Auction Reminder',
                description: 'Send a reminder when a skyblock dark auction is starting.',
                style: InputStyle.Long,
                min: 2,
                max: 150,
                getOption: () => language.getDarkAuctionReminder(),
                setOption: (value) => {
                  language.setDarkAuctionReminder(value)
                }
              },
              {
                type: OptionType.Text,
                name: 'Starfall Cult Reminder',
                description: 'Send a reminder when the skyblock starfall cult gathers.',
                style: InputStyle.Long,
                min: 2,
                max: 150,
                getOption: () => language.getStarfallReminder(),
                setOption: (value) => {
                  language.setStarfallReminder(value)
                }
              }
            ]
          },
          {
            type: OptionType.Category,
            name: 'Chat Commands',
            description: 'Chat commands such as `!cata` and `!iq`.',
            options: [
              {
                type: OptionType.List,
                name: 'Mute',
                description: 'Message to show when `!mute`.',
                style: InputStyle.Short,
                min: 0,
                max: 100,
                getOption: () => language.getCommandMuteGame(),
                setOption: (values) => {
                  language.setCommandMuteGame(values)
                }
              },
              {
                type: OptionType.EmbedCategory,
                name: 'Russian Roulette',
                description: 'Chat Command `!rr`',
                options: [
                  {
                    type: OptionType.List,
                    name: 'Russian Roulette Win',
                    description: 'Message when winning chat command `!rr`.',
                    style: InputStyle.Short,
                    min: 0,
                    max: 100,
                    getOption: () => language.getCommandRouletteWin(),
                    setOption: (values) => {
                      language.setCommandRouletteWin(values)
                    }
                  },
                  {
                    type: OptionType.List,
                    name: 'Russian Roulette Lose',
                    description: 'Message when losing chat command `!rr`.',
                    style: InputStyle.Short,
                    min: 0,
                    max: 100,
                    getOption: () => language.getCommandRouletteLose(),
                    setOption: (values) => {
                      language.setCommandRouletteLose(values)
                    }
                  }
                ]
              },
              {
                type: OptionType.EmbedCategory,
                name: 'Vengeance',
                description: 'Chat Command `!v`',
                options: [
                  {
                    type: OptionType.List,
                    name: 'Vengeance Win',
                    description: 'Message when winning chat command `!v`.',
                    style: InputStyle.Short,
                    min: 0,
                    max: 100,
                    getOption: () => language.getCommandVengeanceWin(),
                    setOption: (values) => {
                      language.setCommandVengeanceWin(values)
                    }
                  },
                  {
                    type: OptionType.List,
                    name: 'Vengeance Draw',
                    description: 'Message when drawing chat command `!v`.',
                    style: InputStyle.Short,
                    min: 0,
                    max: 100,
                    getOption: () => language.getCommandVengeanceDraw(),
                    setOption: (values) => {
                      language.setCommandVengeanceDraw(values)
                    }
                  },
                  {
                    type: OptionType.List,
                    name: 'Vengeance Lose',
                    description: 'Message when losing chat command `!v`.',
                    style: InputStyle.Short,
                    min: 0,
                    max: 100,
                    getOption: () => language.getCommandVengeanceLose(),
                    setOption: (values) => {
                      language.setCommandVengeanceLose(values)
                    }
                  }
                ]
              }
            ]
          },
          {
            type: OptionType.Category,
            name: 'Guild Reaction',
            description: 'Auto replying and reacting to various in-game guild events.',
            options: [
              {
                type: OptionType.List,
                name: 'Join Message List',
                description: 'Send a greeting message when a member joins the guild.',
                style: InputStyle.Long,
                min: 0,
                max: 20,
                getOption: () => language.getGuildJoinReaction(),
                setOption: (values) => {
                  language.setGuildJoinReaction(values)
                }
              },
              {
                type: OptionType.List,
                name: 'Leave Message List',
                description: 'Send a reaction message when a member leaves the guild.',
                style: InputStyle.Long,
                min: 0,
                max: 20,
                getOption: () => language.getGuildLeaveReaction(),
                setOption: (values) => {
                  language.setGuildLeaveReaction(values)
                }
              },
              {
                type: OptionType.List,
                name: 'Kick Message List',
                description: 'Send a reaction message when a member is kicked from the guild.',
                style: InputStyle.Long,
                min: 0,
                max: 20,
                getOption: () => language.getGuildKickReaction(),
                setOption: (values) => {
                  language.setGuildKickReaction(values)
                }
              }
            ]
          }
        ]
      }
    ]
  }
}

function fetchMinecraftOptions(application: Application, context: DiscordCommandContext): CategoryOption {
  const minecraft = application.core.minecraftConfigurations
  const isGlobalAdmin = context.permission === Permission.Admin

  return {
    type: OptionType.Category,
    name: 'Minecraft',
    header: CategoryLabel,
    options: [
      ...(isGlobalAdmin
        ? [
            {
              type: OptionType.EmbedCategory,
              name: 'Staff Options',
              description: 'These are dangerous permissions. Make sure you know what you are doing!',
              options: [
                {
                  type: OptionType.Text,
                  name: 'Admin Username',
                  description: 'In-game username of the person who has full permission over the application.',
                  style: InputStyle.Tiny,
                  max: 16,
                  min: 2,
                  getOption: () => minecraft.getAdminUsername(),
                  setOption: (username: string) => {
                    minecraft.setAdminUsername(username)
                  }
                } satisfies TextOption
              ]
            } satisfies EmbedCategoryOption,
            {
              type: OptionType.Category as const,
              name: 'Chat Processing',
              description: 'Fine tune how chat messages are sent to the game.',
              header: 'Fine tune how chat messages are sent to the game.\n\n' + CategoryLabel,
              options: [
                {
                  type: OptionType.EmbedCategory,
                  name: 'Links Processor',
                  description: 'How to handle links sent to Minecraft.',
                  options: [
                    {
                      type: OptionType.Boolean,
                      name: 'STuF',
                      description:
                        'Bypass Hypixel restriction on hyperlinks using STuF encoding. Only use if you know what STuF is!',
                      getOption: () => minecraft.getHideLinksViaStuf(),
                      toggleOption: () => {
                        minecraft.setHideLinksViaStuf(!minecraft.getHideLinksViaStuf())
                      }
                    } satisfies BooleanOption,
                    {
                      type: OptionType.Boolean,
                      name: `Resolve Links ${Recommended}`,
                      description:
                        'Try resolving the link content like `(video)` instead of showing generic `(link)`. ',
                      getOption: () => minecraft.getResolveHideLinks(),
                      toggleOption: () => {
                        minecraft.setResolveHideLinks(!minecraft.getResolveHideLinks())
                      }
                    } satisfies BooleanOption
                  ]
                } satisfies EmbedCategoryOption,
                {
                  type: OptionType.EmbedCategory,
                  name: 'Anti Spam',
                  description: 'Techniques used to avoid messages being blocked for "can not repeat".',
                  options: [
                    {
                      type: OptionType.Boolean,
                      name: `Enable Antispam ${Essential}`,
                      description:
                        'Use techniques to avoid hypixel blocking a message for "`You cannot say the same message twice!`".',
                      getOption: () => minecraft.getAntispamEnabled(),
                      toggleOption: () => {
                        minecraft.setAntispamEnabled(!minecraft.getAntispamEnabled())
                      }
                    } satisfies BooleanOption
                  ]
                } satisfies EmbedCategoryOption
              ]
            } satisfies CategoryOption
          ]
        : []),
      {
        type: OptionType.EmbedCategory,
        name: 'Instances',
        options: [
          {
            type: OptionType.Action,
            name: 'Instances Status',
            description: 'Fetch Minecraft instances status.',
            label: 'fetch',
            style: ButtonStyle.Primary,
            onInteraction: async (interaction: ButtonInteraction, errorHandler: UnexpectedErrorHandler, helpers) => {
              void helpers
              try {
                return await minecraftInstancesStatus(
                  application,
                  interaction,
                  context.bridgeId,
                  context.permission === Permission.Admin
                )
              } catch (error: unknown) {
                errorHandler.error('fetching minecraft instance status', error)
                return true
              }
            }
          },
          {
            type: OptionType.Action,
            name: 'Instance Add',
            description: 'Add a Minecraft instance.',
            label: 'add',
            style: ButtonStyle.Success,
            onInteraction: (interaction: ButtonInteraction, errorHandler: UnexpectedErrorHandler, helpers) => {
              void helpers
              return minecraftInstanceAdd(application, interaction, errorHandler, context.bridgeId)
            }
          },
          {
            type: OptionType.Action,
            name: 'Instance Remove',
            description: 'Remove a Minecraft instance.',
            label: 'remove',
            style: ButtonStyle.Danger,
            onInteraction: (interaction: ButtonInteraction, errorHandler: UnexpectedErrorHandler, helpers) => {
              void helpers
              return minecraftInstanceRemove(
                application,
                interaction,
                errorHandler,
                context.bridgeId,
                context.permission === Permission.Admin
              )
            }
          },
          {
            type: OptionType.Action,
            name: 'Import Microsoft Auth Cache',
            description:
              'Import Microsoft authentication cache from JSON. Paste the JSON content from your auth-cache files.',
            label: 'import',
            style: ButtonStyle.Secondary,
            onInteraction: (interaction: ButtonInteraction, errorHandler: UnexpectedErrorHandler, helpers) => {
              void helpers
              return minecraftInstanceImportAuthCache(application, interaction, errorHandler, context.bridgeId)
            }
          }
        ] as ActionOption[]
      }
    ]
  }
}

async function minecraftInstancesStatus(
  application: Application,
  interaction: ButtonInteraction,
  bridgeId?: string,
  isAdmin?: boolean
): Promise<boolean> {
  const config = application.core.minecraftSessions
  const savedInstances = config.getAllInstances()
  const instances = application.minecraftManager.getAllInstances()

  const bridgeConfig = application.core.bridgeConfigurations
  const bridgeInstances = bridgeId ? bridgeConfig.getMinecraftInstances(bridgeId) : []
  const includeInstance =
    bridgeId === undefined
      ? (instanceName: string) => {
          void instanceName
          return isAdmin ?? true
        }
      : (instanceName: string) => (isAdmin ?? false) || bridgeInstances.includes(instanceName)

  const embed: APIEmbed = {
    title: 'Minecraft Status',
    fields: [],
    footer: {
      text: DefaultCommandFooter
    }
  }
  assert.ok(embed.fields)

  const registeredInstances = instances.filter(
    (instance) =>
      savedInstances.some((configInstance) => instance.instanceName === configInstance.name) &&
      includeInstance(instance.instanceName)
  )
  embed.fields.push({
    name: 'Registered Instances',
    value:
      registeredInstances.length > 0
        ? registeredInstances
            .map((instance) => `- **${instance.instanceName}:** ${instance.currentStatus()}`)
            .join('\n')
        : '(none registered)'
  } satisfies APIEmbedField)

  const dynamicInstances = instances.filter(
    (instance) =>
      !savedInstances.some((configInstance) => instance.instanceName === configInstance.name) &&
      includeInstance(instance.instanceName)
  )
  if (dynamicInstances.length > 0) {
    embed.fields.push({
      name: 'Dynamic Instances',
      value: dynamicInstances
        .map((instance) => `- **${instance.instanceName}:** ${instance.currentStatus()}`)
        .join('\n')
    } satisfies APIEmbedField)
  }

  const unavailableInstances = savedInstances
    .map((instance) => instance.name)
    .filter(
      (configName) => !instances.some((instance) => instance.instanceName === configName) && includeInstance(configName)
    )
  if (unavailableInstances.length > 0) {
    embed.color = Color.Bad
    embed.description =
      '_Unavailable minecraft instances detected in settings._\n' +
      '_Those instances are registered in settings but not loaded into application._\n' +
      '_This should not happen. Restart the application and check console logs for the reason for this behaviour._'

    embed.fields.push({
      name: 'Unavailable Instances',
      value: unavailableInstances.map((name) => `- ${name}`).join('\n')
    } satisfies APIEmbedField)
  }

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  })

  return true
}

async function minecraftInstanceAdd(
  application: Application,
  interaction: ButtonInteraction,
  errorHandler: UnexpectedErrorHandler,
  bridgeId?: string
): Promise<boolean> {
  await interaction.showModal({
    customId: 'minecraft-instance-add',
    title: `Add Minecraft Instance`,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            customId: 'instance-name',
            style: TextInputStyle.Short,
            label: 'Name',

            minLength: 1,
            maxLength: 128,
            required: true
          }
        ]
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            customId: 'instance-proxy',
            style: TextInputStyle.Short,
            label: 'Proxy URI (Optional)',
            placeholder: 'socks5://username:password@server.com:1080',

            minLength: 0,
            maxLength: 1024,
            required: false
          }
        ]
      }
    ]
  })

  const modalInteraction = await interaction.awaitModalSubmit({
    time: 300_000,
    filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id
  })

  const instanceName = modalInteraction.fields.getTextInputValue('instance-name').trim()
  const proxyOptions = modalInteraction.fields.getTextInputValue('instance-proxy').trim()

  const EmbedTitle = 'Adding new minecraft instance'
  const InitiationTimeout = 30 * 60 * 1000

  try {
    application.applicationIntegrity.ensureInstanceName({
      instanceName: instanceName,
      instanceType: InstanceType.Minecraft
    })
  } catch (error: unknown) {
    errorHandler.error('adding new minecraft instance', error)
    await modalInteraction.reply({
      embeds: [
        {
          title: EmbedTitle,
          description:
            'Minecraft name must be a single word with no spaces or special characters besides alphanumerical letters: A-Z and a-z and 0-9 and "_"',
          color: Color.Error,
          footer: { text: DefaultCommandFooter }
        } satisfies APIEmbed
      ]
    })
    return true
  }

  let proxy: ProxyConfig | undefined = undefined
  if (proxyOptions.length > 0) {
    try {
      proxy = parseSocks5(proxyOptions)
    } catch (error: unknown) {
      errorHandler.error('parsing socks5', error)

      await modalInteraction.reply({
        embeds: [
          {
            title: EmbedTitle,
            description: errorMessage(error),
            color: Color.Error,
            footer: {
              text: DefaultCommandFooter
            }
          } satisfies APIEmbed
        ]
      })
      return true
    }
  }

  const embed: APIEmbed = {
    title: EmbedTitle,
    description: '**Progress:**\n'
  }
  assert.ok(embed.description)

  let sendChainPromise: Promise<InteractionResponse | Message> = modalInteraction.deferReply()
  const deferredReply = await sendChainPromise

  const updateEmbed = () => {
    try {
      return deferredReply.edit({ embeds: [embed] })
    } catch (error: unknown) {
      errorHandler.error('updating adding minecraft instance progress', error)
      return sendChainPromise
    }
  }

  const refresher = setTimeout(() => {
    sendChainPromise = sendChainPromise.then(updateEmbed)
  }, 1000)

  const sleepTimeout = new Timeout<true>(InitiationTimeout)
  const abortController = new AbortController()

  application.on(
    'instanceStatus',
    (event) => {
      if (event.instanceName !== instanceName || event.instanceType !== InstanceType.Minecraft) return

      assert.ok(embed.description)
      const t = application.getTranslatorForBridge(event.bridgeId)
      if (event.status !== undefined) {
        embed.description += `- ${translateInstanceStatusForBridge(t, event.status)}\n`
      }
      if (event.message !== undefined) {
        embed.description += `- ${translateInstanceMessageForBridge(t, event.message.type)}`
        embed.description += event.message.value === undefined ? '\n' : `: ${event.message.value}\n`
      }

      refresher.refresh()
    },
    { signal: abortController.signal }
  )

  application.on(
    'instanceAnnouncement',
    (event) => {
      if (event.instanceName !== instanceName || event.instanceType !== InstanceType.Minecraft) return

      assert.ok(embed.description)
      embed.description += `- Instance has been created\n`
      refresher.refresh()
    },
    { signal: abortController.signal }
  )
  application.on(
    'minecraftSelfBroadcast',
    (event) => {
      if (event.instanceName !== instanceName || event.instanceType !== InstanceType.Minecraft) return

      assert.ok(embed.description)
      embed.description += `- Instance has logged in as ${event.username} (${event.uuid})\n`
      embed.color = Color.Good

      sleepTimeout.resolve(true)
    },
    { signal: abortController.signal }
  )

  try {
    embed.description += `- Creating a fresh Minecraft instance\n`
    await application.minecraftManager.addAndStart({ name: instanceName, proxy: proxy })

    // Persist settings to DB and log current DB state
    application.core.minecraftSessions.addInstance({ name: instanceName, proxy: proxy })
    // Also log a quick DB snapshot for debugging
    debugSessionLog({
      hypothesisId: 'H9',
      location: 'settings.ts:minecraftInstanceAdd:afterAdd',
      message: 'Instance added and persisted',
      data: {
        instanceName,
        configuredInstances: application.core.minecraftSessions.getAllInstances().map((index) => index.name)
      }
    })
    embed.description += `- Instance has been added to settings for future reboot\n`

    if (bridgeId) {
      const instances = application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
      if (!instances.includes(instanceName)) {
        instances.push(instanceName)
        application.core.bridgeConfigurations.setMinecraftInstances(bridgeId, instances)
        embed.description += `- Instance has been associated with this bridge\n`
        debugSessionLog({
          hypothesisId: 'H9',
          location: 'settings.ts:minecraftInstanceAdd:bridgeAssociation',
          message: 'Instance associated to bridge after add',
          data: { bridgeId, instanceName, instances }
        })
        application.bridgeResolver.rebuildLookupMaps()
      }
    }
  } catch (error: unknown) {
    embed.description += `- ERROR: Failed to add minecraft instance. ${errorMessage(error)}\n`
    embed.color = Color.Error
    sleepTimeout.resolve(true)
  }
  await sleepTimeout.wait()

  abortController.abort()
  clearTimeout(refresher)
  await sendChainPromise.then(updateEmbed)
  return true
}

async function minecraftInstanceRemove(
  application: Application,
  interaction: ButtonInteraction,
  errorHandler: UnexpectedErrorHandler,
  bridgeId?: string,
  isAdmin?: boolean
): Promise<boolean> {
  await interaction.showModal({
    customId: 'minecraft-instance-remove',
    title: `Remove Minecraft Instance`,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            customId: 'instance-name',
            style: TextInputStyle.Short,
            label: 'Name',

            minLength: 1,
            maxLength: 128,
            required: true
          }
        ]
      }
    ]
  })

  const modalInteraction = await interaction.awaitModalSubmit({
    time: 300_000,
    filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id
  })

  const instanceName = modalInteraction.fields.getTextInputValue('instance-name')

  if (bridgeId && !isAdmin) {
    const bridgeInstances = application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
    if (!bridgeInstances.includes(instanceName)) {
      await modalInteraction.reply({
        content: `Instance **${instanceName}** is not associated with this bridge.`,
        ephemeral: true
      })
      return true
    }
  }

  const deferredReply = await modalInteraction.deferReply()

  const embed = {
    title: 'Remove Minecraft',
    description: `Removing minecraft \`${escapeMarkdown(instanceName)}\`\n\n`,
    color: Color.Default,
    footer: { text: DefaultCommandFooter }
  } satisfies APIEmbed

  try {
    const results = await application.minecraftManager.removeInstance(instanceName)
    embed.color = Color.Good

    if (results.instanceRemoved === 0) {
      embed.description += '- No active instance to be removed.'
    } else if (results.instanceRemoved === 1) {
      embed.description += '- Active instance has been successfully removed.'
    } else {
      embed.description += `- More than one instance have been detected and removed (total: \`${results.instanceRemoved}\`).`
      embed.color = Color.Info
    }
    embed.description += '\n'

    if (results.deletedConfig === 0) {
      embed.description += '- No relevant configuration has been detected to try and delete.'
    } else if (results.deletedConfig === 1) {
      embed.description += '- Relevant configuration has been detected and deleted.'
    } else {
      embed.description += `- More than one configuration has been detected and removed (total: \`${results.deletedConfig}\`).`
      embed.color = Color.Info
    }
    embed.description += '\n'

    if (results.deletedSessionFiles > 0) {
      embed.description += '- Session files have been detected and deleted.'
    }

    const bridgeConfig = application.core.bridgeConfigurations
    const affectedBridges: string[] = []
    for (const bid of bridgeConfig.getAllBridgeIds()) {
      const instances = bridgeConfig.getMinecraftInstances(bid)
      if (instances.includes(instanceName)) {
        instances.splice(instances.indexOf(instanceName), 1)
        bridgeConfig.setMinecraftInstances(bid, instances)
        affectedBridges.push(bid)
      }
    }
    // Log bridge configuration change for debugging
    if (affectedBridges.length > 0) {
      debugSessionLog({
        hypothesisId: 'H9',
        location: 'settings.ts:minecraftInstanceRemove:affectedBridges',
        message: 'Instance removed from one or more bridges',
        data: { instanceName, affectedBridges }
      })
      debugSessionLog({
        hypothesisId: 'H9',
        location: 'settings.ts:minecraftInstanceRemove:bridgeSnapshot',
        message: 'Bridge snapshot after instance removal',
        data: {
          bridges: bridgeConfig
            .getAllBridgeIds()
            .map((b) => ({ bridge: b, instances: bridgeConfig.getMinecraftInstances(b) }))
        }
      })
    }
    if (affectedBridges.length > 0) {
      application.bridgeResolver.rebuildLookupMaps()
      embed.description +=
        affectedBridges.length === 1
          ? '- Instance has been removed from bridge association.\n'
          : `- Instance has been removed from ${affectedBridges.length} bridge associations.\n`
    }
  } catch (error: unknown) {
    errorHandler.error('removing minecraft instance', error)
    embed.color = Color.Error
    embed.description += italic(
      'An error occurred while trying to remove Minecraft instance\n' +
        'The results are inconclusive.\n' +
        'Check the console logs for further details\n' +
        'Tread carefully when trying anything else.'
    )
  }

  await deferredReply.edit({ embeds: [embed] })

  return true
}

function parseSocks5(url: string): ProxyConfig {
  /*
  Notice: Regex does not detect escape characters.
  Tested regex:
    socks5://username:password@server.com:1080
    socks5://username:password@server.com
    socks5://username@server.com:1080
    socks5://server.com
    socks5://server.com:1080
   */
  const regex = /^(?<type>socks5):\/\/(?:(?<username>\w+):(?<password>[^@]+)@)?(?<host>[^:]+)(?::(?<port>\d+))?$/gm
  const match = regex.exec(url)

  if (match === null)
    throw new Error('Invalid proxy format. e.g. valid proxy: socks5://username:password@server.com:1080')

  const groups = match.groups as {
    type: ProxyProtocol
    username: string | undefined
    password: string | undefined
    host: string
    port: string | undefined
  }
  assert.ok(match.groups)

  const type = groups.type
  const username: string | undefined = groups.username ?? undefined
  const password: string | undefined = groups.password ?? undefined
  const host: string = groups.host
  const port: number = groups.port === undefined ? 1080 : Number.parseInt(groups.port)

  if (type.toLowerCase() !== ProxyProtocol.Socks5.toLowerCase()) {
    throw new Error('invalid proxy type. Only "socks5" is supported.')
  }

  return { id: 0, host: host, port: port, user: username, password: password, protocol: type } satisfies ProxyConfig
}

async function minecraftInstanceImportAuthCache(
  application: Application,
  interaction: ButtonInteraction,
  errorHandler: UnexpectedErrorHandler,
  bridgeId?: string
): Promise<boolean> {
  let instanceName = ''
  let accumulatedJson = ''
  let partNumber = 1
  let currentInteraction: ButtonInteraction = interaction

  const showImportModal = async (isFirstPart: boolean) => {
    await currentInteraction.showModal({
      customId: `minecraft-instance-import-auth-${Date.now()}`,
      title: isFirstPart ? 'Import Microsoft Auth Cache' : `Import Microsoft Auth Cache (Part ${partNumber})`,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              customId: 'instance-name',
              style: TextInputStyle.Short,
              label: 'Instance Name',
              placeholder: 'e.g. myinstance',
              minLength: 1,
              maxLength: 128,
              required: isFirstPart,
              value: isFirstPart ? undefined : instanceName
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              customId: 'json-content',
              style: TextInputStyle.Paragraph,
              label: isFirstPart
                ? 'JSON Content (Part 1 of ?)'
                : `JSON Content (Part ${partNumber}, continue from previous)`,
              placeholder: isFirstPart
                ? "Paste JSON cache entries. If >4000 chars, you'll be prompted for more parts."
                : 'Paste the next part of your JSON. It will be appended to previous parts.',
              minLength: 1,
              maxLength: 4000,
              required: true
            }
          ]
        }
      ]
    })
  }

  // Show first modal
  await showImportModal(true)

  let modalInteraction: Awaited<ReturnType<typeof currentInteraction.awaitModalSubmit>>
  let depth = 0

  for (;;) {
    modalInteraction = await currentInteraction.awaitModalSubmit({
      time: 300_000,
      filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id
    })

    if (partNumber === 1) {
      instanceName = modalInteraction.fields.getTextInputValue('instance-name').trim()
    }
    const jsonPart = modalInteraction.fields.getTextInputValue('json-content').trim()

    // Append this part to accumulated JSON
    accumulatedJson += jsonPart

    // Check if JSON is complete by trying to parse it
    let isComplete = false
    try {
      JSON.parse(accumulatedJson)
      isComplete = true
    } catch {
      // Check if it looks incomplete (missing closing braces)
      const trimmed = accumulatedJson.trim()
      if (trimmed.startsWith('{')) {
        depth = 0
        let inString = false
        let escapeNext = false

        for (const char of trimmed) {
          if (escapeNext) {
            escapeNext = false
            continue
          }
          if (char === '\\') {
            escapeNext = true
            continue
          }
          if (char === '"') {
            inString = !inString
            continue
          }
          if (!inString) {
            if (char === '{') depth++
            else if (char === '}') depth--
          }
        }

        // If depth is 0, JSON might be complete (or we need to check more carefully)
        if (depth === 0) {
          // Try parsing one more time
          try {
            JSON.parse(accumulatedJson)
            isComplete = true
          } catch {
            // Still incomplete, need more parts
            isComplete = false
          }
        } else {
          // Definitely incomplete, need more parts
          isComplete = false
        }
      }
    }

    if (isComplete) {
      // JSON is complete, proceed with import
      break
    } else {
      // JSON is incomplete, ask for more
      partNumber++
      await modalInteraction.reply({
        embeds: [
          {
            title: 'Import Microsoft Auth Cache',
            description: `Received part ${partNumber - 1}. JSON appears incomplete${depth === 0 ? '' : ` (missing ${Math.abs(depth)} closing brace${Math.abs(depth) > 1 ? 's' : ''})`}. Please click the button below to continue with part ${partNumber}.`,
            color: Color.Info,
            footer: { text: DefaultCommandFooter }
          } satisfies APIEmbed
        ],
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                customId: `continue-import-${Date.now()}-${partNumber}`,
                label: `Continue Part ${partNumber}`,
                style: ButtonStyle.Primary
              }
            ]
          }
        ],
        flags: MessageFlags.Ephemeral
      })
      const followUpMessage = await modalInteraction.fetchReply()

      // Wait for button click to continue
      try {
        const buttonInteraction = await followUpMessage.awaitMessageComponent({
          time: 300_000,
          filter: (buttonInteraction) =>
            buttonInteraction.user.id === interaction.user.id && buttonInteraction.isButton()
        })

        if (buttonInteraction.isButton()) {
          currentInteraction = buttonInteraction
          await showImportModal(false)
        } else {
          return true
        }
      } catch {
        // Timeout or error, return
        return true
      }
    }
  }

  // Now we have complete JSON, proceed with validation and import
  const jsonContent = accumulatedJson

  const EmbedTitle = 'Importing Microsoft Auth Cache'

  try {
    application.applicationIntegrity.ensureInstanceName({
      instanceName: instanceName,
      instanceType: InstanceType.Minecraft
    })
  } catch (error: unknown) {
    errorHandler.error('validating instance name for auth cache import', error)
    try {
      await (modalInteraction.replied || modalInteraction.deferred
        ? modalInteraction.followUp({
            embeds: [
              {
                title: EmbedTitle,
                description:
                  'Instance name must be a single word with no spaces or special characters besides alphanumerical letters: A-Z and a-z and 0-9 and "_"',
                color: Color.Error,
                footer: { text: DefaultCommandFooter }
              } satisfies APIEmbed
            ],
            flags: MessageFlags.Ephemeral
          })
        : modalInteraction.reply({
            embeds: [
              {
                title: EmbedTitle,
                description:
                  'Instance name must be a single word with no spaces or special characters besides alphanumerical letters: A-Z and a-z and 0-9 and "_"',
                color: Color.Error,
                footer: { text: DefaultCommandFooter }
              } satisfies APIEmbed
            ],
            flags: MessageFlags.Ephemeral
          }))
    } catch (replyError) {
      errorHandler.error('Failed to send validation error response', replyError)
    }
    return true
  }

  // Check if instance exists
  const instance = application.core.minecraftSessions.getInstance(instanceName)
  if (!instance) {
    try {
      await (modalInteraction.replied || modalInteraction.deferred
        ? modalInteraction.followUp({
            embeds: [
              {
                title: EmbedTitle,
                description: `Instance "${escapeMarkdown(instanceName)}" does not exist. Please create it first using "Instance Add".`,
                color: Color.Error,
                footer: { text: DefaultCommandFooter }
              } satisfies APIEmbed
            ],
            flags: MessageFlags.Ephemeral
          })
        : modalInteraction.reply({
            embeds: [
              {
                title: EmbedTitle,
                description: `Instance "${escapeMarkdown(instanceName)}" does not exist. Please create it first using "Instance Add".`,
                color: Color.Error,
                footer: { text: DefaultCommandFooter }
              } satisfies APIEmbed
            ],
            flags: MessageFlags.Ephemeral
          }))
    } catch (replyError) {
      errorHandler.error('Failed to send instance not found error response', replyError)
    }
    return true
  }

  if (bridgeId) {
    const bridgeInstances = application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
    if (!bridgeInstances.includes(instanceName)) {
      try {
        await (modalInteraction.replied || modalInteraction.deferred
          ? modalInteraction.followUp({
              embeds: [
                {
                  title: EmbedTitle,
                  description: `Instance "${escapeMarkdown(instanceName)}" is not associated with this bridge.`,
                  color: Color.Error,
                  footer: { text: DefaultCommandFooter }
                } satisfies APIEmbed
              ],
              flags: MessageFlags.Ephemeral
            })
          : modalInteraction.reply({
              embeds: [
                {
                  title: EmbedTitle,
                  description: `Instance "${escapeMarkdown(instanceName)}" is not associated with this bridge.`,
                  color: Color.Error,
                  footer: { text: DefaultCommandFooter }
                } satisfies APIEmbed
              ],
              flags: MessageFlags.Ephemeral
            }))
      } catch (replyError) {
        errorHandler.error('Failed to send bridge association error response', replyError)
      }
      return true
    }
  }

  // Import the cache
  const result = application.core.minecraftSessions.importAuthCache(instanceName, instanceName, jsonContent)

  const embed: APIEmbed = {
    title: EmbedTitle,
    description: '',
    color: result.errors.length > 0 ? (result.imported.length > 0 ? Color.Info : Color.Error) : Color.Good,
    footer: { text: DefaultCommandFooter }
  }
  let embedDescription = ''

  if (result.imported.length > 0) {
    embedDescription += `**Successfully imported ${result.imported.length} cache entries:**\n`
    embedDescription += result.imported.map((name) => `- \`${escapeMarkdown(name)}\``).join('\n')
    embedDescription += '\n\n'
  }

  if (result.errors.length > 0) {
    embedDescription += `**Errors (${result.errors.length}):**\n`
    embedDescription += result.errors.map((error) => `- ${escapeMarkdown(error)}`).join('\n')
  }

  if (result.imported.length === 0 && result.errors.length === 0) {
    embedDescription = 'No cache entries found in the JSON data.'
    embed.color = Color.Info
  }
  embed.description = embedDescription

  try {
    // Check if interaction was already replied to (e.g., during multi-part import)
    await (modalInteraction.replied || modalInteraction.deferred
      ? modalInteraction.followUp({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        })
      : modalInteraction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        }))
  } catch {
    // If reply fails, try followUp as fallback
    try {
      await modalInteraction.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      })
    } catch (followUpError) {
      // Log the error so it's visible in logs
      errorHandler.error('Failed to send import result response', followUpError)
      // Try to send a simple error message
      try {
        await (!modalInteraction.replied && !modalInteraction.deferred
          ? modalInteraction.reply({
              content: `Import completed: ${result.imported.length} imported, ${result.errors.length} errors. Check logs for details.`,
              flags: MessageFlags.Ephemeral
            })
          : modalInteraction.followUp({
              content: `Import completed: ${result.imported.length} imported, ${result.errors.length} errors. Check logs for details.`,
              flags: MessageFlags.Ephemeral
            }))
      } catch {
        // Last resort: use error handler to log
        errorHandler.error('Failed to send any import result feedback to user', {
          imported: result.imported,
          errors: result.errors,
          instanceName
        })
      }
    }
  }

  return true
}

function errorMessage(error: unknown): string {
  if (error === undefined || error === null) return `${error}`

  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return JSON.stringify(error)
}
