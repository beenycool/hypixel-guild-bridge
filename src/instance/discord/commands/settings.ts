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
import { Color, InstanceType, Permission } from '../../../common/application-event.js'
import type { DiscordCommandContext, DiscordCommandHandler } from '../../../common/commands.js'
import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler.js'
import { translateInstanceMessage, translateInstanceStatus } from '../../../core/instance/instance-language'
import { ApplicationLanguages, LanguageConfigurations } from '../../../core/language-configurations'
import type { ProxyConfig } from '../../../core/minecraft/sessions-manager'
import { ProxyProtocol } from '../../../core/minecraft/sessions-manager'
import { SpontaneousEventsNames } from '../../../core/spontanmous-events-configurations'
import Duration from '../../../utility/duration'
import { SkyblockEventKeys } from '../../../utility/skyblock-calendar'
import { Timeout } from '../../../utility/timeout.js'
import { DefaultCommandFooter } from '../common/discord-config.js'
import type { BooleanOption, CategoryOption, EmbedCategoryOption } from '../utility/options-handler.js'
import { InputStyle, OptionsHandler, OptionType } from '../utility/options-handler.js'

const Essential = ':shield:'
const Recommended = ':beginner:'
const Warning = ':warning:'

const CategoryLabel =
  `Options marked with ${Essential} are essential. Change at your own risk.\n` +
  `Options marked with ${Recommended} are recommended for quality of life.\n` +
  `Options marked with ${Warning} should only be messed with if you know what you are doing.\n` +
  `Check [the documentations](https://github.com/aidn3/hypixel-guild-discord-bridge/blob/master/docs/FAQ.md) for more information.`

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

    const options: EmbedCategoryOption = {
      type: OptionType.EmbedCategory,
      get name() {
        return context.application.i18n.t(($) => $['discord.commands.settings.main.title'])
      },
      get description() {
        return context.application.i18n.t(($) => $['discord.commands.settings.main.description'])
      },

      options: [
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
              } satisfies CategoryOption['options'][number],
              fetchGeneralOptions(context.application)
            ]
          : []),
        fetchBridgeOptions(context.application, context),
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
): CategoryOption {
  const bridgeConfig = application.core.bridgeConfigurations

  // Dynamic Skyblock options for per-event toggling
  const skyblockEventOptions = SkyblockEventKeys.map(
    (key) =>
      ({
        type: OptionType.Boolean,
        // name typed as any to satisfy Option typing (key is a constant string union)
        name: key as any,
        description: `Enable notifications for ${key}`,
        getOption: () => bridgeConfig.getSkyblockEventNotifiers(bridgeId)?.[key] ?? true,
        toggleOption: () => {
          const current = bridgeConfig.getSkyblockEventNotifiers(bridgeId) ?? {}
          bridgeConfig.setSkyblockEventNotifier(bridgeId, key, !(current[key] ?? true))
          application.emit('bridgeConfigChanged', {
            bridgeId,
            key: `${bridgeId}_skyblockNotifiers`,
            value: { [key]: !(current[key] ?? true) }
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
            name: 'Officer Roles',
            description: `Staff roles that have permissions to execute destructive commands such as \`/kick\` in bridge "${bridgeId}"`,
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
            type: OptionType.Number,
            name: 'Delete Temporary Events After (Seconds)',
            description: 'How long to keep temporary events (Online/Offline) before deleting them.',
            min: 1,
            max: 43_200,
            getOption: () => bridgeConfig.getDurationTemporarilyInteractions(bridgeId).toSeconds(),
            setOption: (value) => {
              bridgeConfig.setDurationTemporarilyInteractions(bridgeId, Duration.seconds(value))
            }
          },
          {
            type: OptionType.Number,
            name: 'Max Temporary Events',
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
              application.emit('bridgeConfigChanged', {
                bridgeId,
                key: `${bridgeId}_skyblockEventsEnabled`,
                value: newValue
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
              {
                type: OptionType.List,
                name: 'Join Message List',
                description: 'Messages sent when a member joins the guild. Use {username} for the player name.',
                style: InputStyle.Long,
                min: 0,
                max: 20,
                showDelete: false,
                getOption: () =>
                  bridgeConfig.getGuildJoinReactionMessages(
                    bridgeId,
                    application.core.languageConfigurations.getGuildJoinReaction()
                  ),
                setOption: (values) => {
                  bridgeConfig.setGuildJoinReactionMessages(bridgeId, values)
                }
              },
              {
                type: OptionType.List,
                name: 'Leave Message List',
                description: 'Messages sent when a member leaves the guild. Use {username} for the player name.',
                style: InputStyle.Long,
                min: 0,
                max: 20,
                showDelete: false,
                getOption: () =>
                  bridgeConfig.getGuildLeaveReactionMessages(
                    bridgeId,
                    application.core.languageConfigurations.getGuildLeaveReaction()
                  ),
                setOption: (values) => {
                  bridgeConfig.setGuildLeaveReactionMessages(bridgeId, values)
                }
              },
              {
                type: OptionType.List,
                name: 'Kick Message List',
                description:
                  'Messages sent when a member is kicked from the guild. Use {username} for the player name.',
                style: InputStyle.Long,
                min: 0,
                max: 20,
                showDelete: false,
                getOption: () =>
                  bridgeConfig.getGuildKickReactionMessages(
                    bridgeId,
                    application.core.languageConfigurations.getGuildKickReaction()
                  ),
                setOption: (values) => {
                  bridgeConfig.setGuildKickReactionMessages(bridgeId, values)
                }
              }
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
            onInteraction: async (interaction) => {
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

function fetchBridgeOptions(application: Application, context: DiscordCommandContext): CategoryOption {
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
      onInteraction: async (interaction) => {
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
        const newBridgeOption = createBridgeOption(application, bridgeId, bridgeSubOptions)
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
      bridgeSubOptions.push(createBridgeOption(application, bridgeId, bridgeSubOptions))
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

            name: 'Officer Roles',
            description: 'Staff roles that have permissions to execute destructive commands such as `/kick`.',

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
                  setOption: (username) => {
                    minecraft.setAdminUsername(username)
                  }
                }
              ]
            },
            {
              type: OptionType.Category,
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
                    },
                    {
                      type: OptionType.Boolean,
                      name: `Resolve Links ${Recommended}`,
                      description:
                        'Try resolving the link content like `(video)` instead of showing generic `(link)`. ',
                      getOption: () => minecraft.getResolveHideLinks(),
                      toggleOption: () => {
                        minecraft.setResolveHideLinks(!minecraft.getResolveHideLinks())
                      }
                    }
                  ]
                },
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
                    }
                  ]
                }
              ]
            }
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

            onInteraction: (interaction) => minecraftInstancesStatus(application, interaction, context.bridgeId)
          },
          {
            type: OptionType.Action,

            name: 'Instance Add',
            description: 'Add a Minecraft instance.',
            label: 'add',
            style: ButtonStyle.Success,

            onInteraction: (interaction, errorHandler) =>
              minecraftInstanceAdd(application, interaction, errorHandler, context.bridgeId)
          },
          {
            type: OptionType.Action,

            name: 'Instance Remove',
            description: 'Remove a Minecraft instance.',
            label: 'remove',
            style: ButtonStyle.Danger,

            onInteraction: (interaction, errorHandler) =>
              minecraftInstanceRemove(application, interaction, errorHandler, context.bridgeId)
          },
          {
            type: OptionType.Action,

            name: 'Import Microsoft Auth Cache',
            description:
              'Import Microsoft authentication cache from JSON. Paste the JSON content from your auth-cache files.',
            label: 'import',
            style: ButtonStyle.Secondary,

            onInteraction: (interaction, errorHandler) =>
              minecraftInstanceImportAuthCache(application, interaction, errorHandler, context.bridgeId)
          }
        ]
      }
    ]
  }
}

async function minecraftInstancesStatus(
  application: Application,
  interaction: ButtonInteraction,
  bridgeId?: string
): Promise<boolean> {
  const config = application.core.minecraftSessions
  const savedInstances = config.getAllInstances()
  const instances = application.minecraftManager.getAllInstances()

  const bridgeInstances = bridgeId ? application.core.bridgeConfigurations.getMinecraftInstances(bridgeId) : []

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
      (!bridgeId || bridgeInstances.includes(instance.instanceName))
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
      (!bridgeId || bridgeInstances.includes(instance.instanceName))
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
      (configName) =>
        !instances.some((instance) => instance.instanceName === configName) &&
        (!bridgeId || bridgeInstances.includes(configName))
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
        embed.description += `- ${translateInstanceStatus(t, event.status)}\n`
      }
      if (event.message !== undefined) {
        embed.description += `- ${translateInstanceMessage(t, event.message.type)}`
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

    application.core.minecraftSessions.addInstance({ name: instanceName, proxy: proxy })
    embed.description += `- Instance has been added to settings for future reboot\n`

    if (bridgeId) {
      const instances = application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
      if (!instances.includes(instanceName)) {
        instances.push(instanceName)
        application.core.bridgeConfigurations.setMinecraftInstances(bridgeId, instances)
        embed.description += `- Instance has been associated with this bridge\n`
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
  bridgeId?: string
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

  if (bridgeId) {
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
      embed.description += `- More than one instance have been detected and removed (total: \`${results.instanceRemoved}\`)\`.`
      embed.color = Color.Info
    }
    embed.description += '\n'

    if (results.deletedConfig === 0) {
      embed.description += '- No relevant configuration has been detected to try and delete.'
    } else if (results.deletedConfig === 1) {
      embed.description += '- Relevant configuration has been detected and deleted.'
    } else {
      embed.description += `- More than one configuration has been detected and removed (total: \`${results.deletedConfig}\`)\`.`
      embed.color = Color.Info
    }
    embed.description += '\n'

    if (results.deletedSessionFiles > 0) {
      embed.description += '- Session files have been detected and deleted.'
    }

    if (bridgeId) {
      const instances = application.core.bridgeConfigurations.getMinecraftInstances(bridgeId)
      const index = instances.indexOf(instanceName)
      if (index !== -1) {
        instances.splice(index, 1)
        application.core.bridgeConfigurations.setMinecraftInstances(bridgeId, instances)
        embed.description += '- Instance has been removed from this bridge association.\n'
      }
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

  while (true) {
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
      const followUpMessage = await modalInteraction.reply({
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
        flags: MessageFlags.Ephemeral,
        fetchReply: true
      })

      // Wait for button click to continue
      try {
        const buttonInteraction = await followUpMessage.awaitMessageComponent({
          time: 300_000,
          filter: (buttonInteraction_) =>
            buttonInteraction_.user.id === interaction.user.id && buttonInteraction_.isButton()
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

  if (result.imported.length > 0) {
    embed.description += `**Successfully imported ${result.imported.length} cache entries:**\n`
    embed.description += result.imported.map((name) => `- \`${escapeMarkdown(name)}\``).join('\n')
    embed.description += '\n\n'
  }

  if (result.errors.length > 0) {
    embed.description += `**Errors (${result.errors.length}):**\n`
    embed.description += result.errors.map((error) => `- ${escapeMarkdown(error)}`).join('\n')
  }

  if (result.imported.length === 0 && result.errors.length === 0) {
    embed.description = 'No cache entries found in the JSON data.'
    embed.color = Color.Info
  }

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
