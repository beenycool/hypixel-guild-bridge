import type { ButtonInteraction } from 'discord.js'
import { ButtonStyle, MessageFlags } from 'discord.js'

import type Application from '../../../../../application.js'
import type { CategoryOption, OptionItem } from '../../../utility/options-handler.js'
import { InputStyle, OptionType } from '../../../utility/options-handler.js'

export async function buildRankupOption(application: Application, bridgeId: string): Promise<CategoryOption> {
  const bridgeConfig = application.core.bridgeConfigurations

  let guildRanks: string[] = []
  try {
    const instances = bridgeConfig.getMinecraftInstances(bridgeId)
    if (instances.length > 0) {
      const botInstanceName = instances[0]
      const mcInstance = application.minecraftManager
        .getAllInstances()
        .find((inst) => inst.instanceName.toLowerCase() === botInstanceName.toLowerCase())
      const botUuid = mcInstance?.uuid()
      if (botUuid) {
        application.logger.debug(`Fetching guild ranks for bridge ${bridgeId} using bot UUID ${botUuid}`)
        const guild = await application.hypixelApi.getGuild('player', botUuid)
        if (guild?.ranks) {
          guildRanks = guild.ranks.map((r) => r.name)
          application.logger.debug(
            `Fetched ${guildRanks.length} guild ranks for bridge ${bridgeId}: [${guildRanks.join(', ')}]`
          )
        }
      } else {
        application.logger.warn(`Minecraft instance ${botInstanceName} is not connected or UUID is unavailable`)
      }
    }
  } catch (error: unknown) {
    application.logger.error(`Failed to fetch guild ranks for bridge ${bridgeId}:`, error)
  }

  let cachedPromotionOptions: CategoryOption['options'] | undefined
  let cachedDemotionOptions: CategoryOption['options'] | undefined

  return {
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
        max: 168,
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
      // Promotion Rules
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
      // Demotion Rules
      {
        type: OptionType.Category,
        name: 'Demotion Rules',
        description: 'Configure rules for automatically demoting or kicking guild members.',
        header: `**Demotion Rules for ${bridgeId}**\n\nConfigure automatic demotion/kick rules based on GEXP and other criteria.`,
        get options() {
          if (cachedDemotionOptions !== undefined) return cachedDemotionOptions

          cachedDemotionOptions = []
          const demoRules = bridgeConfig.getRankupDemotionRules(bridgeId)

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
              description: 'Ranks that should never be touched by the auto-rankup system (e.g. Guild Master, Officer).',
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
              description: 'Ranks that should never be touched by the auto-rankup system (e.g. Guild Master, Officer).',
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
  }
}
