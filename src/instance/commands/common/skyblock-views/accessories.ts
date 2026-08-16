import assert from 'node:assert'

import type { SkyblockV2Member } from 'hypixel-api-reborn'
import { parse } from 'prismarine-nbt'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { shortenNumber } from '../utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const accessoriesView: SkyblockView = {
  name: 'acc',
  description: "Returns a player's accessory bag stats (magical power, power stone, tuning, enrichments)",
  example: 'sb %s acc',
  needsProfile: true,

  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined
  ): Promise<string> {
    assert.ok(selected)
    const accessoryStorage = selected.member.accessory_bag_storage
    if (!accessoryStorage) return `${username} has no accessory data or API is off.`

    const magicalPower = accessoryStorage.highest_magical_power

    const selectedPower = accessoryStorage.selected_power ?? 'None'

    const tuning = accessoryStorage.tuning.slot_0
    const tuningStats: string[] = []
    if (tuning) {
      for (const [stat, value] of Object.entries(tuning)) {
        if (value > 0) {
          tuningStats.push(`${stat}: ${value}`)
        }
      }
    }

    const tuningDisplay = tuningStats.length > 0 ? tuningStats.join(', ') : 'None'

    const enrichments = await getEnrichments(selected.member)

    let result = `${username}'s Accessories: ${shortenNumber(magicalPower)} MP | `
    result += `Power: ${selectedPower} | Tuning: ${tuningDisplay}`

    result += ` | Enrich: `
    if (enrichments.length === 0) result += `(none)`
    else {
      const formatted: string[] = []
      for (const enrichment of enrichments) {
        formatted.push(enrichment.count.toLocaleString('en-US') + translatePower(enrichment.name))
      }

      result += formatted.join(', ')
    }

    return result
  }
}

function translatePower(power: string): string {
  return power
    .split('_')
    .map((name) => name.slice(0, 1))
    .join('')
}

async function getEnrichments(member: SkyblockV2Member): Promise<{ name: string; count: number }[]> {
  const bagRaw = member.inventory?.bag_contents?.talisman_bag
  if (bagRaw === undefined) return []

  const parsed = await parse(Buffer.from(bagRaw.data, 'base64'))
  const parsedData = parsed.parsed.value as Record<string, unknown> | undefined
  const slots = parsedData?.i as { value?: { value: InventorySlot[] } } | undefined
  const slotItems: InventorySlot[] = slots?.value?.value ?? []

  const result: { name: string; count: number }[] = []
  for (const slot of slotItems) {
    if (!('tag' in slot)) continue

    const attributes = slot.tag.value.ExtraAttributes?.value
    if (!attributes) continue

    const enrichment = attributes.talisman_enrichment?.value
    if (!enrichment) continue

    let type = result.find((entry) => entry.name === enrichment)
    if (type == undefined) {
      type = { name: enrichment, count: 0 }
      result.push(type)
    }

    type.count++
  }

  result.sort((a, b) => b.count - a.count)
  return result
}

/* eslint-disable @typescript-eslint/naming-convention */
type InventorySlot = InventoryItemSlot | Record<never, never>

interface InventoryItemSlot {
  id: { value: number }
  count: { value: number }
  tag: { value: ItemData }
}

interface ItemData {
  ExtraAttributes?: { value: SkyblockItemAttributes }
}

interface SkyblockItemAttributes {
  talisman_enrichment?: { value: string }
}

/* eslint-enable @typescript-eslint/naming-convention */
