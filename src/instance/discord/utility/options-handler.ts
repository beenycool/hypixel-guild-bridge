import assert from 'node:assert'
import * as crypto from 'node:crypto'

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  CollectedInteraction,
  CommandInteraction,
  ComponentInContainerData,
  ContainerComponentData,
  InteractionResponse,
  MessageComponentInteraction,
  ModalMessageModalSubmitInteraction,
  SectionComponentData
} from 'discord.js'
import {
  bold,
  ButtonStyle,
  ChannelType,
  ComponentType,
  escapeMarkdown,
  MessageFlags,
  SelectMenuDefaultValueType,
  SeparatorSpacingSize,
  TextInputStyle
} from 'discord.js'

import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler.js'
import { debugSessionLog } from '../../../utility/debug-session-log.js'

export const DEFAULT_PAGE_SIZE = 6
export const MAX_COMPONENTS = 39

export enum OptionType {
  Category = 'category',
  EmbedCategory = 'subcategory',
  Label = 'label',

  Text = 'text',
  Number = 'number',
  Boolean = 'boolean',

  List = 'list',
  PresetList = 'preset-list',

  Action = 'action',

  Channel = 'channel',
  Role = 'role',
  User = 'user'
}

export type OptionItem =
  | CategoryOption
  | EmbedCategoryOption
  | LabelOption
  | TextOption
  | NumberOption
  | BooleanOption
  | ListOption
  | PresetListOption
  | ActionOption
  | DiscordSelectOption

interface BaseOption {
  type: OptionType

  name: string
  description?: string
}

export interface CategoryOption extends BaseOption {
  type: OptionType.Category
  header?: string
  options: OptionItem[]
}

export interface EmbedCategoryOption extends BaseOption {
  type: OptionType.EmbedCategory
  options: Exclude<OptionItem, EmbedCategoryOption>[]
}

export interface LabelOption extends BaseOption {
  type: OptionType.Label
  getOption: undefined | (() => string)
}

export interface BooleanOption extends BaseOption {
  type: OptionType.Boolean
  getOption: () => boolean
  toggleOption: () => void
}

export interface DiscordSelectOption extends BaseOption {
  type: OptionType.Channel | OptionType.Role | OptionType.User
  getOption: () => string[]
  setOption: (value: string[]) => void
  max: number
  min: number
}

export interface ListOption extends BaseOption {
  type: OptionType.List
  getOption: () => string[]
  setOption: (value: string[]) => void
  style: InputStyle.Long | InputStyle.Short
  max: number
  min: number
  // When false, the delete action and UI will not be created/rendered for this list
  showDelete?: boolean
}

export interface PresetListOption extends BaseOption {
  type: OptionType.PresetList
  getOption: () => string[]
  setOption: (value: string[]) => void
  max: number
  min: number
  options: { label: string; value: string; description?: string }[] // Add preset options
}

export enum InputStyle {
  Short = 'short',
  Long = 'long',
  Tiny = 'tiny'
}

export interface TextOption extends BaseOption {
  type: OptionType.Text
  style: InputStyle
  getOption: () => string
  setOption: (value: string) => void
  max: number
  min: number
}

export interface NumberOption extends BaseOption {
  type: OptionType.Number
  getOption: () => number
  setOption: (value: number) => void
  max: number
  min: number
}

export interface ActionOption extends BaseOption {
  type: OptionType.Action
  label: string
  style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger
  onInteraction: (interaction: ButtonInteraction, errorHandler: UnexpectedErrorHandler) => Promise<boolean>
}

interface OptionId {
  action: 'default' | 'add' | 'delete'
  item: OptionItem
}

export class OptionsHandler {
  public static readonly BackButton = 'back-button'
  private static readonly InactivityTime = 600_000
  private originalReply: InteractionResponse | undefined
  private enabled = true
  private path: string[] = []
  private ids = new Map<string, OptionId>()
  private pages = new Map<string, number>()

  constructor(private readonly mainCategory: CategoryOption | EmbedCategoryOption) {
    this.rebuildIds()

    // Initialize page state for the current path
    this.pages.set(this.getPathKey(), 0)
  }

  /**
   * Rebuilds the ID map to include any new options that have been added dynamically.
   * This preserves existing IDs for options that already have them, ensuring
   * that navigation paths remain valid.
   */
  private rebuildIds(): void {
    // Build a reverse map of existing options to their IDs
    const existingOptionIds = new Map<OptionItem, string>()
    for (const [id, entry] of this.ids.entries()) {
      if (entry.action === 'default') {
        existingOptionIds.set(entry.item, id)
      }
    }

    // Find the current max ID number to continue from
    let currentId = 0
    for (const id of this.ids.keys()) {
      const match = /^component-(\d+)$/.exec(id)
      if (match) {
        const idNumber = Number.parseInt(match[1], 10)
        if (idNumber >= currentId) {
          currentId = idNumber + 1
        }
      }
    }

    const allComponents = this.flattenOptions([this.mainCategory])
    for (const component of allComponents) {
      // Skip if this option already has an ID
      if (existingOptionIds.has(component)) {
        continue
      }

      this.ids.set(`component-${currentId++}`, { action: 'default', item: component })

      if (component.type === OptionType.List) {
        this.ids.set(`component-${currentId++}`, { action: 'add', item: component })
        // Only create delete action if the option allows it (default is to allow delete)
        if ((component as ListOption).showDelete !== false) {
          this.ids.set(`component-${currentId++}`, { action: 'delete', item: component })
        }
      }
    }
  }

  public async forwardInteraction(interaction: ChatInputCommandInteraction, errorHandler: UnexpectedErrorHandler) {
    const originalReply = await interaction.reply({
      components: [
        new ViewBuilder(
          this.mainCategory,
          this.ids,
          this.path,
          this.enabled,
          this.pages.get(this.getPathKey()) ?? 0,
          DEFAULT_PAGE_SIZE
        ).create()
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] }
    })

    this.originalReply = originalReply
    const replyId = await originalReply.fetch().then((message) => message.id)
    const collector = originalReply.createMessageComponentCollector({
      filter: (messageInteraction) =>
        messageInteraction.user.id === interaction.user.id && messageInteraction.message.id === replyId
    })
    const timeoutId = setTimeout(() => {
      collector.stop()
    }, OptionsHandler.InactivityTime)

    collector.on('collect', (messageInteraction) => {
      timeoutId.refresh()
      void Promise.resolve()
        .then(async () => {
          const alreadyReplied = await this.handleInteraction(messageInteraction, errorHandler)

          // Rebuild IDs to pick up any dynamically added options
          this.rebuildIds()

          // Check if the message interaction is still valid before trying to update
          await (messageInteraction.deferred || messageInteraction.replied
            ? this.updateView()
            : messageInteraction.update({
                components: [
                  new ViewBuilder(
                    this.mainCategory,
                    this.ids,
                    this.path,
                    this.enabled,
                    this.pages.get(this.getPathKey()) ?? 0,
                    DEFAULT_PAGE_SIZE
                  ).create()
                ],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] }
              }))
        })
        .catch((error) => {
          // Log the error but don't try to acknowledge the interaction again
          errorHandler.promiseCatch('updating container')(error)
          // If interaction is still valid, try to update it with error state
          if (!messageInteraction.deferred && !messageInteraction.replied) {
            messageInteraction
              .update({
                components: [],
                flags: MessageFlags.IsComponentsV2
              })
              .catch(() => {
                // Ignore errors when trying to clean up failed interactions
              })
          }
        })
    })

    collector.on('end', () => {
      this.enabled = false
      void this.updateView().catch(errorHandler.promiseCatch('updating container'))
    })
  }

  private async updateView(interaction?: ModalMessageModalSubmitInteraction): Promise<void> {
    // Rebuild IDs to pick up any dynamically added options
    this.rebuildIds()

    if (interaction !== undefined) {
      // Check if the modal interaction is still valid before updating
      if (!interaction.deferred && !interaction.replied) {
        await interaction.update({
          components: [
            new ViewBuilder(
              this.mainCategory,
              this.ids,
              this.path,
              this.enabled,
              this.pages.get(this.getPathKey()) ?? 0,
              DEFAULT_PAGE_SIZE
            ).create()
          ],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] }
        })
      }
      return
    }

    // Check if original reply is still available
    if (!this.originalReply) {
      // Original reply is not available for update
      return
    }

    try {
      await this.originalReply.edit({
        components: [
          new ViewBuilder(
            this.mainCategory,
            this.ids,
            this.path,
            this.enabled,
            this.pages.get(this.getPathKey()) ?? 0,
            DEFAULT_PAGE_SIZE
          ).create()
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
      })
    } catch {
      // If the message was deleted or we can't edit it, just log and continue
      // Could not update original reply, message might have been deleted
    }
  }

  private async handleInteraction(
    interaction: CollectedInteraction,
    errorHandler: UnexpectedErrorHandler
  ): Promise<boolean> {
    // Page navigation handling
    if (typeof interaction.customId === 'string' && interaction.customId.startsWith('options:page:')) {
      assert.ok(interaction.isButton())

      const part = interaction.customId.split(':')[2]
      const key = this.getPathKey()
      const current = this.pages.get(key) ?? 0

      // Compute bounds
      const currentCategory = this.getCurrentCategory()
      const totalOptions = currentCategory.options.length
      const totalPages = Math.max(1, Math.ceil(totalOptions / DEFAULT_PAGE_SIZE))

      let nextPage = current
      if (part === 'next') nextPage = Math.min(totalPages - 1, current + 1)
      else if (part === 'prev') nextPage = Math.max(0, current - 1)
      else {
        const parsed = Number.parseInt(part, 10)
        if (!Number.isNaN(parsed)) nextPage = Math.max(0, Math.min(totalPages - 1, parsed))
      }

      this.pages.set(key, nextPage)
      return false
    }



    if (interaction.customId === OptionsHandler.BackButton) {
      this.path.pop()
      // reset page for new current path
      this.pages.set(this.getPathKey(), 0)
      return false
    }

    const foundOption = this.ids.get(interaction.customId)
    assert.ok(foundOption !== undefined)
    const option = foundOption.item
    const action = foundOption.action

    switch (option.type) {
      case OptionType.Category: {
        assert.ok(action === 'default')

        this.path.push(interaction.customId)
        // Reset page for the new path
        this.pages.set(this.getPathKey(), 0)
        return false
      }

      case OptionType.Boolean: {
        assert.ok(action === 'default')

        option.toggleOption()
        return false
      }
      case OptionType.Text: {
        assert.ok(action === 'default')
        return await this.handleText(interaction, errorHandler, option)
      }
      case OptionType.Number: {
        assert.ok(action === 'default')
        return await this.handleNumber(interaction, errorHandler, option)
      }
      case OptionType.List: {
        if (action === 'add') {
          return await this.handleListAdd(interaction, option)
        } else if (action === 'delete') {
          return this.handleListDelete(interaction, option)
        }

        break
      }

      case OptionType.PresetList: {
        assert.ok(action === 'default')
        return this.handlePresetList(interaction, option)
      }

      case OptionType.Channel: {
        assert.ok(action === 'default')
        return this.handleChannel(interaction, option)
      }
      case OptionType.Role: {
        assert.ok(action === 'default')
        assert.ok(interaction.isRoleSelectMenu())
        option.setOption(interaction.values)
        return false
      }

      case OptionType.User: {
        assert.ok(action === 'default')

        assert.ok(interaction.isUserSelectMenu())
        option.setOption(interaction.values)
        return false
      }

      case OptionType.Action: {
        assert.ok(action === 'default')
        return await this.handleAction(interaction, errorHandler, option)
      }
    }

    return false
  }

  private handleChannel(interaction: CollectedInteraction, option: DiscordSelectOption): boolean {
    assert.ok(interaction.isChannelSelectMenu())
    option.setOption(interaction.values)
    return false
  }

  private async handleText(
    interaction: CollectedInteraction,
    errorHandler: UnexpectedErrorHandler,
    option: TextOption
  ): Promise<boolean> {
    assert.ok(interaction.isButton())
    await interaction.showModal({
      customId: interaction.customId,
      title: `Setting ${option.name}`,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              customId: interaction.customId,
              style: option.style === InputStyle.Long ? TextInputStyle.Paragraph : TextInputStyle.Short,
              label: option.name,

              required: true,
              minLength: option.min,
              maxLength: option.max,
              value: option.getOption()
            }
          ]
        }
      ]
    })

    interaction
      .awaitModalSubmit({
        time: 300_000,
        filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id
      })
      .then(async (modalInteraction) => {
        assert.ok(modalInteraction.isFromMessage())

        const value = modalInteraction.fields.getTextInputValue(interaction.customId)
        option.setOption(value)
        await this.updateView(modalInteraction)
      })
      .catch(errorHandler.promiseCatch(`handling modal submit for ${interaction.customId}`))

    return true
  }

  private async handleNumber(
    interaction: CollectedInteraction,
    errorHandler: UnexpectedErrorHandler,
    option: NumberOption
  ): Promise<boolean> {
    assert.ok(interaction.isButton())
    // #region agent log
    debugSessionLog({
      hypothesisId: 'H1',
      location: 'options-handler.ts:handleNumber:open',
      message: 'Number modal opening',
      data: {
        optionName: option.name,
        getOptionValue: option.getOption(),
        customId: interaction.customId
      }
    })
    // #endregion
    await interaction.showModal({
      customId: interaction.customId,
      title: `Setting ${option.name}`,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              customId: interaction.customId,
              style: TextInputStyle.Short,
              label: option.name,

              minLength: 1,
              required: true,
              value: option.getOption().toString(10)
            }
          ]
        }
      ]
    })

    interaction
      .awaitModalSubmit({
        time: 300_000,
        filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id
      })
      .then(async (modalInteraction) => {
        assert.ok(modalInteraction.isFromMessage())

        const value = modalInteraction.fields.getTextInputValue(interaction.customId).trim()
        const intValue = value.includes('.') ? Number.parseFloat(value) : Number.parseInt(value, 10)
        const normalizedOk = value === intValue.toString(10)
        const rangeOk = intValue >= option.min && intValue <= option.max
        // #region agent log
        debugSessionLog({
          hypothesisId: 'H2_H3',
          location: 'options-handler.ts:handleNumber:submit',
          message: 'Number modal submit',
          data: {
            optionName: option.name,
            raw: value,
            intValue,
            min: option.min,
            max: option.max,
            normalizedOk,
            rangeOk,
            willApply: rangeOk && normalizedOk
          }
        })
        // #endregion
        if (intValue < option.min || intValue > option.max || value !== intValue.toString(10)) {
          await modalInteraction.reply({
            content: `**${option.name}** must be a number between ${option.min} and ${option.max}.\nGiven: ${escapeMarkdown(value)}`,
            flags: MessageFlags.Ephemeral
          })
        } else {
          // #region agent log
          debugSessionLog({
            hypothesisId: 'H2',
            location: 'options-handler.ts:handleNumber:beforeSetOption',
            message: 'Calling setOption',
            data: { optionName: option.name, intValue }
          })
          // #endregion
          option.setOption(intValue)
          await this.updateView(modalInteraction)
        }
      })
      .catch(errorHandler.promiseCatch(`handling modal submit for ${interaction.customId}`))

    return true
  }

  private async handleAction(
    interaction: CollectedInteraction,
    errorHandler: UnexpectedErrorHandler,
    option: ActionOption
  ): Promise<boolean> {
    assert.ok(interaction.isButton())
    return await option.onInteraction(interaction, errorHandler)
  }

  private async handleListAdd(interaction: CollectedInteraction, option: ListOption): Promise<boolean> {
    assert.ok(interaction.isButton())

    await interaction.showModal({
      customId: interaction.customId,
      title: `Adding To ${option.name}`,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              customId: interaction.customId,
              style: option.style === InputStyle.Short ? TextInputStyle.Short : TextInputStyle.Paragraph,
              label: option.name,

              minLength: 1,
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
    assert.ok(modalInteraction.isFromMessage())

    const value = modalInteraction.fields.getTextInputValue(interaction.customId).trim()
    const allOptions = option.getOption()

    if (allOptions.includes(value)) {
      await modalInteraction.reply({
        content: `Value already added to **${option.name}**.`,
        flags: MessageFlags.Ephemeral
      })
    } else {
      option.setOption([...allOptions, value])
      await this.updateView(modalInteraction)
    }

    return true
  }

  private handleListDelete(interaction: CollectedInteraction, option: ListOption): boolean {
    assert.ok(interaction.isStringSelectMenu())

    const valuesToDelete = interaction.values
    const allOptions = option.getOption()
    const newValues = allOptions.filter((value) => !valuesToDelete.includes(hashOptionValue(value)))

    assert.notStrictEqual(allOptions.length, newValues.length)
    option.setOption(newValues)

    return false
  }

  private handlePresetList(interaction: CollectedInteraction, option: PresetListOption): boolean {
    assert.ok(interaction.isStringSelectMenu())
    option.setOption(interaction.values)
    return false
  }

  private flattenOptions(options: OptionItem[]): OptionItem[] {
    const flatOptions: OptionItem[] = []
    for (const option of options) {
      switch (option.type) {
        case OptionType.Category:
        case OptionType.EmbedCategory: {
          flatOptions.push(option, ...this.flattenOptions(option.options))
          break
        }
        default: {
          flatOptions.push(option)
          break
        }
      }
    }

    return flatOptions
  }

  private getPathKey(): string {
    return this.path.join('|')
  }

  private getCurrentCategory(): CategoryOption | EmbedCategoryOption {
    if (this.path.length === 0) return this.mainCategory

    const lastPath = this.path.at(-1)
    assert.ok(lastPath)

    const category = this.ids.get(lastPath)?.item
    assert.ok(category !== undefined, `Can not find path to the category. Given: ${this.path.join(', ')}`)
    assert.ok(category.type === OptionType.Category || category.type === OptionType.EmbedCategory)

    return category
  }
}

class ViewBuilder {
  private hasCreated = false

  private separatorApplied = false
  private categoryEnded = false
  private components: ComponentInContainerData[] = []
  private skipped = false

  constructor(
    private readonly mainCategory: CategoryOption | EmbedCategoryOption,
    private readonly ids: Map<string, OptionId>,
    private readonly path: string[],
    private readonly enabled: boolean,
    private readonly page: number,
    private readonly pageSize: number,
    private titleCreated = false
  ) {}

  public create(): ContainerComponentData {
    if (this.hasCreated) throw new Error('This instance has already been used to create a view.')
    this.hasCreated = true



    this.createCategoryView(this.getOption())
    return { type: ComponentType.Container, components: this.components } satisfies ContainerComponentData
  }

  private createCategoryView(categoryOption: CategoryOption | EmbedCategoryOption): void {
    this.addTitleIfPossible(categoryOption)

    // Build option blocks (each option may produce multiple components)
    const optionBlocks: ComponentInContainerData[][] = []

    for (const option of categoryOption.options) {
      this.handleEndCategory()
      const block: ComponentInContainerData[] = []

      switch (option.type) {
        case OptionType.Category: {
          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`

          block.push({
            type: ComponentType.Section,
            components: [{ type: ComponentType.TextDisplay, content: label }],
            accessory: {
              type: ComponentType.Button,
              disabled: !this.enabled,
              label: 'Open',
              style: ButtonStyle.Primary,
              customId: this.getId(option)
            }
          } as SectionComponentData)
          break
        }

        case OptionType.EmbedCategory: {
          this.tryApplySeperator(SeparatorSpacingSize.Small)

          let label = `## ${option.name}`
          if (option.description !== undefined) label += `\n-# ${option.description}`

          block.push({ type: ComponentType.TextDisplay, content: label })

          // Recurse into embed category and push its blocks inline
          const nestedBuilder = new ViewBuilder(option, this.ids, [], this.enabled, 0, this.pageSize, true)
          const nested = nestedBuilder.create()
          block.push(...(nested.components as ComponentInContainerData[]))

          this.categoryEnded = true
          break
        }

        case OptionType.Label: {
          let message = `**${option.name}**`
          if (option.description !== undefined) message += `\n-# ${option.description}`
          if (option.getOption !== undefined) message += `\n-# **Current Value:** ${escapeMarkdown(option.getOption())}`
          block.push({ type: ComponentType.TextDisplay, content: message })

          break
        }

        case OptionType.Boolean: {
          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`

          block.push({
            type: ComponentType.Section,
            components: [{ type: ComponentType.TextDisplay, content: label }],
            accessory: {
              type: ComponentType.Button,
              disabled: !this.enabled,
              label: option.getOption() ? 'ON' : 'OFF',
              style: option.getOption() ? ButtonStyle.Success : ButtonStyle.Secondary,
              customId: this.getId(option)
            }
          })

          break
        }

        case OptionType.List: {
          const addAction = [...this.ids.entries()].find(([, entry]) => entry.item === option && entry.action === 'add')
          assert.ok(addAction !== undefined, 'Could not find add action?')

          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`
          block.push({
            type: ComponentType.Section,
            components: [{ type: ComponentType.TextDisplay, content: label }],
            accessory: {
              type: ComponentType.Button,
              disabled: !this.enabled,
              customId: addAction[0],
              label: 'Add',
              style: ButtonStyle.Primary
            }
          })

          if ((option as ListOption).showDelete === false) {
            // Deletion disabled for this list; do not render delete controls.
          } else {
            const deleteAction = [...this.ids.entries()].find(
              ([, entry]) => entry.item === option && entry.action === 'delete'
            )
            assert.ok(deleteAction !== undefined, 'Could not find delete action?')

            const mentionedValues = new Set<string>()
            const values = []
            for (const value of option.getOption()) {
              if (mentionedValues.has(value)) continue
              mentionedValues.add(value)

              values.push({
                label: this.shortenString(value, 100),
                value: hashOptionValue(value)
              })
            }

            if (values.length > 0) {
              block.push({
                type: ComponentType.ActionRow,
                components: [
                  {
                    type: ComponentType.StringSelect,
                    customId: deleteAction[0],
                    disabled: !this.enabled,
                    placeholder: 'Select from the list to DELETE.',

                    minValues: option.min,
                    maxValues: Math.min(values.length, option.max),

                    options: values
                  }
                ]
              })
            } else {
              block.push({
                type: ComponentType.ActionRow,
                components: [
                  {
                    type: ComponentType.StringSelect,
                    customId: deleteAction[0],
                    disabled: true,
                    placeholder: '(empty)',

                    minValues: 0,
                    maxValues: 1,

                    options: [{ label: '(empty)', value: '0' }]
                  }
                ]
              })
            }
          }

          break
        }

        case OptionType.PresetList: {
          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`

          const currentSelection = option.getOption()
          if (currentSelection.length > 1) {
            label += `\n-# **Selected:** ${currentSelection.length} option${currentSelection.length === 1 ? '' : 's'}`
          }

          block.push({ type: ComponentType.TextDisplay, content: label })

          const selectOptions = option.options.map((opt) => ({
            label: opt.label,
            value: opt.value,
            description: opt.description,
            default: currentSelection.includes(opt.value)
          }))

          block.push({
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.StringSelect,
                customId: this.getId(option),
                disabled: !this.enabled,
                placeholder: currentSelection.length > 0 ? `${currentSelection.length} selected` : 'Select options...',
                minValues: option.min,
                maxValues: Math.min(option.options.length, option.max),
                options: selectOptions
              }
            ]
          })

          break
        }

        case OptionType.Channel: {
          assert.ok(option.type === OptionType.Channel)

          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`
          block.push({ type: ComponentType.TextDisplay, content: label })

          block.push({
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.ChannelSelect,
                customId: this.getId(option),
                disabled: !this.enabled,
                minValues: option.min,
                maxValues: option.max,
                channelTypes: [ChannelType.GuildText],
                defaultValues: option.getOption().map((o) => ({ id: o, type: SelectMenuDefaultValueType.Channel }))
              }
            ]
          })

          break
        }

        case OptionType.Role: {
          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`
          block.push({ type: ComponentType.TextDisplay, content: label })

          block.push({
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.RoleSelect,
                customId: this.getId(option),
                disabled: !this.enabled,
                minValues: option.min,
                maxValues: option.max,
                defaultValues: option.getOption().map((o) => ({ id: o, type: SelectMenuDefaultValueType.Role }))
              }
            ]
          })

          break
        }

        case OptionType.User: {
          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`
          block.push({ type: ComponentType.TextDisplay, content: label })

          block.push({
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.UserSelect,
                customId: this.getId(option),
                disabled: !this.enabled,
                minValues: option.min,
                maxValues: option.max,
                defaultValues: option.getOption().map((o) => ({ id: o, type: SelectMenuDefaultValueType.User }))
              }
            ]
          })

          break
        }

        case OptionType.Text: {
          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`
          let buttonLabel: string

          switch (option.style) {
            case InputStyle.Tiny: {
              buttonLabel = option.getOption()
              break
            }
            case InputStyle.Short:
            case InputStyle.Long: {
              buttonLabel = 'Edit'
              label += `\n> -# ${escapeMarkdown(this.shortenString(option.getOption(), 200))}`
            }
          }

          block.push({
            type: ComponentType.Section,
            components: [{ type: ComponentType.TextDisplay, content: label }],
            accessory: {
              type: ComponentType.Button,
              disabled: !this.enabled,
              label: buttonLabel,
              style: ButtonStyle.Primary,
              customId: this.getId(option)
            }
          })

          break
        }

        case OptionType.Number: {
          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`

          block.push({
            type: ComponentType.Section,
            components: [{ type: ComponentType.TextDisplay, content: label }],
            accessory: {
              type: ComponentType.Button,
              disabled: !this.enabled,
              label: option.getOption().toString(10),
              style: ButtonStyle.Primary,
              customId: this.getId(option)
            }
          })

          break
        }

        case OptionType.Action: {
          let label = bold(option.name)
          if (option.description !== undefined) label += `\n-# ${option.description}`

          block.push({
            type: ComponentType.Section,
            components: [{ type: ComponentType.TextDisplay, content: label }],
            accessory: {
              type: ComponentType.Button,
              disabled: !this.enabled,
              label: option.label,
              style: option.style,
              customId: this.getId(option)
            }
          })

          break
        }
        // No default
      }

      optionBlocks.push(block)
    }

    // Apply pagination by options
    const totalPages = Math.max(1, Math.ceil(optionBlocks.length / this.pageSize))
    const page = Math.max(0, Math.min(this.page, totalPages - 1))
    const start = page * this.pageSize
    const end = start + this.pageSize

    for (const block of optionBlocks.slice(start, end)) {
      for (const component of block) {
        this.append(component)
      }
    }

    // If there are multiple pages, add pager controls
    if (totalPages > 1) {
      const pageText = { type: ComponentType.TextDisplay, content: `Page ${page + 1} / ${totalPages}` }
      this.append({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            customId: `options:page:prev`,
            label: 'Prev',
            style: ButtonStyle.Secondary,
            disabled: page === 0
          },
          {
            type: ComponentType.Button,
            customId: `options:page:next`,
            label: 'Next',
            style: ButtonStyle.Primary,
            disabled: page === totalPages - 1
          }
        ]
      })
      this.append(pageText)
    }

    // Safety clamp: ensure we never exceed MAX_COMPONENTS
    if (this.skipped || this.countTotalComponents(this.components) > MAX_COMPONENTS) {
      const noteComponent: ComponentInContainerData = {
        type: ComponentType.TextDisplay,
        content: '**Note:** Too many items to display. Narrow your selection.'
      }
      const noteCount = this.getComponentCount(noteComponent)

      while (this.components.length > 0 && this.countTotalComponents(this.components) + noteCount > MAX_COMPONENTS) {
        this.components.pop()
      }
      this.components.push(noteComponent)
    }
  }

  private addTitleIfPossible(currentCategory: CategoryOption | EmbedCategoryOption) {
    if (!this.titleCreated) {
      this.titleCreated = true

      const title = { type: ComponentType.TextDisplay, content: this.createTitle() }
      if (this.path.length === 0) {
        this.append(title)
      } else {
        this.append({
          type: ComponentType.Section,
          components: [title],
          accessory: {
            type: ComponentType.Button,

            label: 'Back',
            customId: OptionsHandler.BackButton,

            style: ButtonStyle.Secondary,
            disabled: !this.enabled
          }
        })
      }



      if ('header' in currentCategory && currentCategory.header !== undefined) {
        this.append({ type: ComponentType.TextDisplay, content: currentCategory.header })
      } else if (currentCategory.description !== undefined) {
        this.append({ type: ComponentType.TextDisplay, content: currentCategory.description })
      }

      this.tryApplySeperator(SeparatorSpacingSize.Large)
    }
  }

  private addCategory(option: CategoryOption): void {
    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`

    this.append({
      type: ComponentType.Section,
      components: [{ type: ComponentType.TextDisplay, content: label }],
      accessory: {
        type: ComponentType.Button,
        disabled: !this.enabled,
        label: 'Open',
        style: ButtonStyle.Primary,
        customId: this.getId(option)
      }
    } satisfies SectionComponentData)
  }

  private addEmbedCategory(option: EmbedCategoryOption): void {
    this.tryApplySeperator(SeparatorSpacingSize.Small)

    let label = `## ${option.name}`
    if (option.description !== undefined) label += `\n-# ${option.description}`

    this.append({ type: ComponentType.TextDisplay, content: label })

    this.createCategoryView(option)
    this.categoryEnded = true
  }

  private addLabel(option: LabelOption): void {
    let message = `**${option.name}**`
    if (option.description !== undefined) message += `\n-# ${option.description}`
    if (option.getOption !== undefined) message += `\n-# **Current Value:** ${escapeMarkdown(option.getOption())}`
    this.append({ type: ComponentType.TextDisplay, content: message })
  }

  private addBoolean(option: BooleanOption): void {
    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`

    this.append({
      type: ComponentType.Section,
      components: [{ type: ComponentType.TextDisplay, content: label }],
      accessory: {
        type: ComponentType.Button,
        disabled: !this.enabled,
        label: option.getOption() ? 'ON' : 'OFF',
        style: option.getOption() ? ButtonStyle.Success : ButtonStyle.Secondary,
        customId: this.getId(option)
      }
    })
  }

  private addList(option: ListOption): void {
    const addAction = [...this.ids.entries()].find(([, entry]) => entry.item === option && entry.action === 'add')
    assert.ok(addAction !== undefined, 'Could not find add action?')

    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`
    this.append({
      type: ComponentType.Section,
      components: [{ type: ComponentType.TextDisplay, content: label }],
      accessory: {
        type: ComponentType.Button,
        disabled: !this.enabled,
        customId: addAction[0],
        label: 'Add',
        style: ButtonStyle.Primary
      }
    })

    const deleteAction = [...this.ids.entries()].find(([, entry]) => entry.item === option && entry.action === 'delete')
    assert.ok(deleteAction !== undefined, 'Could not find delete action?')

    const mentionedValues = new Set<string>()
    const values = []
    for (const value of option.getOption()) {
      if (mentionedValues.has(value)) continue
      mentionedValues.add(value)

      values.push({
        label: this.shortenString(value, 100),
        value: hashOptionValue(value)
      })
    }

    if (values.length > 0) {
      this.append({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            customId: deleteAction[0],
            disabled: !this.enabled,
            placeholder: 'Select from the list to DELETE.',

            minValues: option.min,
            maxValues: Math.min(values.length, option.max),

            options: values
          }
        ]
      })
    } else {
      this.append({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            customId: deleteAction[0],
            disabled: true,
            placeholder: '(empty)',

            minValues: 0,
            maxValues: 1,

            options: [{ label: '(empty)', value: '0' }]
          }
        ]
      })
    }
  }

  private addPresetList(option: PresetListOption): void {
    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`

    // Show current selection count
    const currentSelection = option.getOption()
    if (currentSelection.length > 1) {
      label += `\n-# **Selected:** ${currentSelection.length} option${currentSelection.length === 1 ? '' : 's'}`
    }

    this.append({ type: ComponentType.TextDisplay, content: label })

    // Create select menu options with current selections marked as default
    const selectOptions = option.options.map((opt) => ({
      label: opt.label,
      value: opt.value,
      description: opt.description,
      default: currentSelection.includes(opt.value)
    }))

    this.append({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: this.getId(option),
          disabled: !this.enabled,
          placeholder: currentSelection.length > 0 ? `${currentSelection.length} selected` : 'Select options...',
          minValues: option.min,
          maxValues: Math.min(option.options.length, option.max),
          options: selectOptions
        }
      ]
    })
  }

  private addChannel(option: DiscordSelectOption): void {
    assert.ok(option.type === OptionType.Channel)

    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`
    this.append({ type: ComponentType.TextDisplay, content: label })

    this.append({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.ChannelSelect,
          customId: this.getId(option),
          disabled: !this.enabled,
          minValues: option.min,
          maxValues: option.max,
          channelTypes: [ChannelType.GuildText],
          defaultValues: option.getOption().map((o) => ({ id: o, type: SelectMenuDefaultValueType.Channel }))
        }
      ]
    })
  }

  private addRole(option: DiscordSelectOption): void {
    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`
    this.append({ type: ComponentType.TextDisplay, content: label })

    this.append({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.RoleSelect,
          customId: this.getId(option),
          disabled: !this.enabled,
          minValues: option.min,
          maxValues: option.max,
          defaultValues: option.getOption().map((o) => ({ id: o, type: SelectMenuDefaultValueType.Role }))
        }
      ]
    })
  }

  private addUser(option: DiscordSelectOption): void {
    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`
    this.append({ type: ComponentType.TextDisplay, content: label })

    this.append({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.UserSelect,
          customId: this.getId(option),
          disabled: !this.enabled,
          minValues: option.min,
          maxValues: option.max,
          defaultValues: option.getOption().map((o) => ({ id: o, type: SelectMenuDefaultValueType.User }))
        }
      ]
    })
  }

  private addText(option: TextOption): void {
    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`
    let buttonLabel: string

    switch (option.style) {
      case InputStyle.Tiny: {
        buttonLabel = option.getOption()
        break
      }
      case InputStyle.Short:
      case InputStyle.Long: {
        buttonLabel = 'Edit'
        label += `\n> -# ${escapeMarkdown(this.shortenString(option.getOption(), 200))}`
      }
    }

    this.append({
      type: ComponentType.Section,
      components: [{ type: ComponentType.TextDisplay, content: label }],
      accessory: {
        type: ComponentType.Button,
        disabled: !this.enabled,
        label: buttonLabel,
        style: ButtonStyle.Primary,
        customId: this.getId(option)
      }
    })
  }

  private addNumber(option: NumberOption): void {
    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`

    this.append({
      type: ComponentType.Section,
      components: [{ type: ComponentType.TextDisplay, content: label }],
      accessory: {
        type: ComponentType.Button,
        disabled: !this.enabled,
        label: option.getOption().toString(10),
        style: ButtonStyle.Primary,
        customId: this.getId(option)
      }
    })
  }

  private addAction(option: ActionOption): void {
    let label = bold(option.name)
    if (option.description !== undefined) label += `\n-# ${option.description}`

    this.append({
      type: ComponentType.Section,
      components: [{ type: ComponentType.TextDisplay, content: label }],
      accessory: {
        type: ComponentType.Button,
        disabled: !this.enabled,
        label: option.label,
        style: option.style,
        customId: this.getId(option)
      }
    })
  }

  private handleEndCategory(): void {
    if (this.categoryEnded) {
      this.categoryEnded = false
      this.tryApplySeperator(SeparatorSpacingSize.Small)
    }
  }

  private countTotalComponents(components: ComponentInContainerData[]): number {
    let count = 0
    for (const component of components) {
      count++
      if ('components' in component && Array.isArray(component.components)) {
        count += this.countTotalComponents(component.components as ComponentInContainerData[])
      }
      if ('accessory' in component && component.accessory !== undefined) {
        count++
      }
    }
    return count
  }

  private getComponentCount(component: ComponentInContainerData): number {
    let count = 1
    if ('components' in component && Array.isArray(component.components)) {
      count += this.countTotalComponents(component.components as ComponentInContainerData[])
    }
    if ('accessory' in component && component.accessory !== undefined) {
      count++
    }
    return count
  }

  private append(component: ComponentInContainerData): void {
    assert.ok(component.type !== ComponentType.Separator, 'use applySeperator() instead')

    // Check if adding this component would exceed Discord's component limit
    if (this.countTotalComponents(this.components) + this.getComponentCount(component) > MAX_COMPONENTS) {
      this.skipped = true
      return
    }

    this.components.push(component)
    this.separatorApplied = false
  }

  private tryApplySeperator(size: SeparatorSpacingSize): void {
    if (this.separatorApplied) return

    const separator: ComponentInContainerData = { type: ComponentType.Separator, spacing: size }

    // Check if adding this separator would exceed Discord's component limit
    if (this.countTotalComponents(this.components) + this.getComponentCount(separator) > MAX_COMPONENTS) {
      this.skipped = true
      return
    }

    this.components.push(separator)
    this.separatorApplied = true
  }

  private getOption(): CategoryOption | EmbedCategoryOption {
    if (this.path.length === 0) return this.mainCategory

    const lastPath = this.path.at(-1)
    assert.ok(lastPath)

    const category = this.ids.get(lastPath)?.item
    assert.ok(category !== undefined, `Can not find path to the category. Given: ${this.path.join(', ')}`)
    assert.ok(category.type === OptionType.Category || category.type === OptionType.EmbedCategory)

    return category
  }

  private flattenWithPath(
    current: CategoryOption | EmbedCategoryOption,
    parentPath: string[] = []
  ): { item: OptionItem; path: string[] }[] {
    const results: { item: OptionItem; path: string[] }[] = []

    for (const option of current.options) {
      // Include the option itself
      results.push({ item: option, path: parentPath })

      // Recurse into categories
      if (option.type === OptionType.Category || option.type === OptionType.EmbedCategory) {
        results.push(...this.flattenWithPath(option, [...parentPath, option.name]))
      }
    }

    return results
  }

  private createTitle(): string {
    let title = `# ${escapeMarkdown(this.mainCategory.name)}`

    for (const path of this.path) {
      const categoryOption = this.ids.get(path)?.item
      assert.ok(categoryOption !== undefined, `Can not find path to the category. Given: ${this.path.join(', ')}`)
      title += ` > ${escapeMarkdown(categoryOption.name)}`
    }

    return title
  }

  private getId(option: OptionItem): string {
    for (const [id, optionEntry] of this.ids.entries()) {
      if (option === optionEntry.item) return id
    }
    throw new Error(`could not find id for option name ${option.name}`)
  }

  private shortenString(value: string, max: number): string {
    const suffix = '...'
    if (value.length <= max) return value
    return value.slice(0, max - suffix.length) + suffix
  }
}

export { ViewBuilder }

export async function getNumber(
  interaction: MessageComponentInteraction | CommandInteraction,
  option: Omit<NumberOption, 'getOption' | 'setOption'>,
  defaultValue: number | undefined,
  title: string | undefined
): Promise<number> {
  const customId = 'customId' in interaction ? interaction.customId : interaction.id
  await interaction.showModal({
    customId: customId,
    title: title ?? `Setting ${option.name}`,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            customId: customId,
            style: TextInputStyle.Short,
            label: option.name,

            minLength: 1,
            required: true,
            value: defaultValue === undefined ? undefined : defaultValue.toString(10)
          }
        ]
      }
    ]
  })

  const result = await interaction.awaitModalSubmit({
    time: 300_000,
    filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id
  })

  const value = result.fields.getTextInputValue(customId).trim()
  const intValue = value.includes('.') ? Number.parseFloat(value) : Number.parseInt(value, 10)

  if (intValue < option.min || intValue > option.max || value !== intValue.toString(10)) {
    const errorMessage = `**${option.name}** must be a number between ${option.min} and ${option.max}.\nGiven: ${escapeMarkdown(value)}`
    await (result.replied
      ? result.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral })
      : result.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }))

    throw new Error(errorMessage)
  }

  await result.deferUpdate()
  return intValue
}

function hashOptionValue(value: string): string {
  return crypto.hash('sha256', value)
}
