import assert from 'node:assert'

import type { CategoryOption, OptionItem } from '../src/instance/discord/utility/options-handler.js'
import {
  DEFAULT_PAGE_SIZE,
  MAX_COMPONENTS,
  OptionType,
  ViewBuilder
} from '../src/instance/discord/utility/options-handler.js'

const Many = 50
const OptionsList: { type: OptionType.Label; name: string; getOption: undefined }[] = []
for (let index = 0; index < Many; index++) {
  OptionsList.push({ type: OptionType.Label, name: `Item ${index}`, getOption: undefined })
}

const BigCategory = {
  type: OptionType.Category,
  name: 'Big Category',
  options: OptionsList
} as unknown as CategoryOption

const IdsMap = new Map<string, { action: 'default' | 'add' | 'delete'; item: OptionItem }>()
const View = new ViewBuilder(BigCategory, IdsMap, [], true, 0, DEFAULT_PAGE_SIZE).create()

if (View.components.length > MAX_COMPONENTS)
  throw new Error(`components exceed MAX_COMPONENTS (${View.components.length} > ${MAX_COMPONENTS})`)

function hasCustomId(component: unknown, customId: string): boolean {
  const record = component as Record<string, unknown> | null | undefined
  if (record?.customId === customId) return true
  if (Array.isArray(record?.components)) {
    for (const inner of record.components as unknown[]) {
      if (hasCustomId(inner, customId)) return true
    }
  }
  return false
}

const HasNext = View.components.some((component: unknown) => hasCustomId(component, 'options:page:next'))
if (!HasNext) throw new Error('expected a Next page button for large category')

assert.ok(true, 'options-handler pagination basic tests')
