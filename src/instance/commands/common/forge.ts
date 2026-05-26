import type { SkyblockV2Member } from 'hypixel-api-reborn'

import forgeData from '../../../resources/data/forge-items.json' with { type: 'json' }

interface ForgeProcess {
  id: string
  slot: number
  startTime: number
}

type ForgeProfile = SkyblockV2Member & {
  forge?: {
    forgeProcesses?: {
      forge1?: Record<string, ForgeProcess>
    }
  }
}

interface RawMiningCore {
  nodes?: { forgeTime?: number; [key: string]: number | undefined }
  experience?: number
}

interface RawMiningProfile {
  miningCore?: RawMiningCore
}

function extractMiningCore(member: SkyblockV2Member): RawMiningCore | undefined {
  const rawMember = member as unknown as RawMiningProfile & Record<string, unknown>
  const legacyKey = 'mining_core'
  return (rawMember.miningCore ?? rawMember[legacyKey]) as RawMiningCore | undefined
}

export interface ForgeItemSummary {
  id: string
  name: string
  slot: number
  timeStarted: number
  timeFinished: number
  timeFinishedText: string
}

interface ForgeItemEntry {
  name: string
  duration: number
}

const ForgeItems = new Map(Object.entries(forgeData.forgeItems)) as Map<string, ForgeItemEntry>

const QuickForgeMultiplier = new Map(Object.entries(forgeData.quickForgeMultiplier).map(([k, v]) => [Number(k), v]))
export function getForgeItems(profile: SkyblockV2Member): ForgeItemSummary[] | undefined {
  const forgeData = (profile as ForgeProfile).forge?.forgeProcesses?.forge1
  if (!forgeData) return undefined

  const processes = Object.values(forgeData)
  if (processes.length === 0) return []

  const quickForge = extractMiningCore(profile)?.nodes?.forgeTime
  const multiplier = quickForge ? (QuickForgeMultiplier.get(quickForge) ?? 1) : 1

  return processes.map((process) => {
    const known = ForgeItems.get(process.id)
    const duration = known?.duration ? known.duration * multiplier : 0
    const timeFinished = process.startTime + duration

    return {
      id: process.id,
      name: known?.name ?? 'Unknown Item',
      slot: process.slot,
      timeStarted: process.startTime,
      timeFinished: timeFinished,
      timeFinishedText: duration > 0 ? formatForgeTimeRemaining(timeFinished) : ''
    }
  })
}

function formatForgeTimeRemaining(timeFinished: number): string {
  if (timeFinished <= Date.now()) return '(FINISHED)'

  const diff = timeFinished - Date.now()
  const totalMinutes = Math.max(1, Math.floor(diff / 60_000))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)

  return ` (${parts.join(' ')})`
}
