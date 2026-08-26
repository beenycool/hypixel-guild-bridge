import type {
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  MessageComponentInteraction,
  ModalMessageModalSubmitInteraction
} from 'discord.js'
import { ComponentType, escapeMarkdown, MessageFlags, TextInputStyle } from 'discord.js'

import type UnexpectedErrorHandler from '../../../common/unexpected-error-handler.js'

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

type OptionItem =
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

  stableId?: string
}

interface CategoryOption extends BaseOption {
  type: OptionType.Category
  header?: string
  options: OptionItem[]
}

interface EmbedCategoryOption extends BaseOption {
  type: OptionType.EmbedCategory
  options: Exclude<OptionItem, EmbedCategoryOption>[]
}

interface LabelOption extends BaseOption {
  type: OptionType.Label
  getOption: undefined | (() => string)
}

interface BooleanOption extends BaseOption {
  type: OptionType.Boolean
  getOption: () => boolean
  toggleOption: () => void
}

interface DiscordSelectOption extends BaseOption {
  type: OptionType.Channel | OptionType.Role | OptionType.User
  getOption: () => string[]
  setOption: (value: string[]) => void
  max: number
  min: number
}

interface ListOption extends BaseOption {
  type: OptionType.List
  getOption: () => string[]
  setOption: (value: string[]) => void
  style: InputStyle.Long | InputStyle.Short
  max: number
  min: number

  showDelete?: boolean
}

interface PresetListOption extends BaseOption {
  type: OptionType.PresetList
  getOption: () => string[]
  setOption: (value: string[]) => void
  max: number
  min: number
  options: { label: string; value: string; description?: string }[]
}

enum InputStyle {
  Short = 'short',
  Long = 'long',
  Tiny = 'tiny'
}

interface TextOption extends BaseOption {
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

interface ActionOption extends BaseOption {
  type: OptionType.Action
  label: string
  style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger
  onInteraction: (
    interaction: ButtonInteraction,
    errorHandler: UnexpectedErrorHandler,
    helpers: ActionInteractionHelpers
  ) => Promise<boolean>
}

interface ActionInteractionHelpers {
  updateView: (interaction?: ModalMessageModalSubmitInteraction) => Promise<void>
}

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
