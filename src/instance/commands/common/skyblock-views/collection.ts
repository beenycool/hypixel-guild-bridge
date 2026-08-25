import assert from 'node:assert'

import type { ChatCommandContext } from '../../../../common/commands.js'
import { calculateLevenshteinDistance } from '../../../../common/commands.js'
import { search } from '../../../../utility/shared-utility.js'

import { type SelectedSkyblockProfile, type SkyblockView } from './types.js'

export const collectionView: SkyblockView = {
  name: 'collection',
  description: "Returns a player's skyblock collection stats",
  example: 'sb %s collection birch',
  needsProfile: true,

  // eslint-disable-next-line @typescript-eslint/require-await
  async render(
    context: ChatCommandContext,
    username: string,
    uuid: string,
    selected: SelectedSkyblockProfile | undefined,
    argumentValues: string[]
  ): Promise<string> {
    assert.ok(selected)
    const collections = selected.member.collection
    if (collections === undefined) return `${username} has their Collections API disabled.`

    const query = argumentValues.join(' ')
    const translated = new Map<string, string>()
    for (const collectionName of Object.keys(collections)) {
      translated.set(normalize(collectionName), collectionName)
    }

    const translatedWord = search(query, translated.keys().toArray()).at(0)
    if (translatedWord === undefined) {
      const suggestions = translated
        .keys()
        .toArray()
        .map((key) => ({
          key,
          distance: calculateLevenshteinDistance(query.toLowerCase(), key.toLowerCase())
        }))
        .filter((s) => s.distance <= 2)
        .toSorted((a, b) => a.distance - b.distance)

      if (suggestions.length > 0) {
        const suggestionKey = translated.get(suggestions[0].key)
        if (suggestionKey !== undefined) {
          const suggestion = beautify(suggestionKey)
          return `${username} not such a collection: ${query}. Did you mean ${suggestion}?`
        }
      }
      return `${username} not such a collection: ${query}`
    }

    const collectionKey = translated.get(translatedWord)
    assert.ok(collectionKey !== undefined)

    const collection = collections[collectionKey]
    const displayCollectionName = beautify(collectionKey)
    return `${username}'s ${displayCollectionName} collection: ${collection.toLocaleString('en-US')}.`
  }
}

const Translator: Record<string, string> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  LOG: 'OAK_LOG',
  'LOG:1': 'SPRUCE_LOG',
  'LOG:2': 'BIRCH_LOG',
  'LOG:3': 'JUNGLE_LOG',

  LOG_2: 'ACACIA_LOG',
  'LOG_2:1': 'DARK_OAK_LOG',

  INK_SACK: 'INK_SACK',
  'INK_SACK:3': 'COCOA_BEANS',
  'INK_SACK:4': 'LAPIS_Lazuli',

  RAW_FISH: 'RAW_COD',
  'RAW_FISH:1': 'RAW_SALMON',
  'RAW_FISH:2': 'TROPICAL_FISH',
  'RAW_FISH:3': 'PUFFERFISH',

  SAND: 'SAND',
  'SAND:1': 'RED_SAND'
  /* eslint-enable @typescript-eslint/naming-convention */
}

function normalize(word: string): string {
  const translated = Translator[word] as string | undefined
  if (translated !== undefined) word = translated
  return word.toLowerCase().replaceAll('_', ' ')
}

function beautify(word: string): string {
  const translated = Translator[word] as string | undefined
  if (translated !== undefined) word = translated
  return word
    .toLowerCase()
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}
