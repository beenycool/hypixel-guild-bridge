import type { Logger } from 'log4js'

import { Instance } from '../common/instance.js'

const COLOR_CODE_PATTERN = /\u00A7[0-9a-fk-or]/gi

const GUILD_LIST_LINE_PATTERN = /^(?:Guild Name:|Online Members:|Total Members:|-{2,})/

const MAX_LOGGERS = 100
const loggerCache = new Map<string, Logger>()

export function getLogger(instanceName: string): Logger {
  let logger = loggerCache.get(instanceName)
  if (logger !== undefined) return logger

  logger = Instance.createLogger(instanceName)

  if (loggerCache.size >= MAX_LOGGERS) {
    const firstKey = loggerCache.keys().next().value
    if (firstKey !== undefined) loggerCache.delete(firstKey)
  }

  loggerCache.set(instanceName, logger)
  return logger
}

export function stripColorCodesAndNormalize(s: string | number | boolean | undefined | null): string {
  if (s === undefined || s === null) return ''
  return String(s).replaceAll(COLOR_CODE_PATTERN, '').replaceAll(/\s+/g, ' ').trim()
}

export function truncate(s: string, n = 120): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

export function isGuildListLine(message: string): boolean {
  return GUILD_LIST_LINE_PATTERN.test(message.trim())
}

interface EventSummaryData {
  instanceName: string
  bridgeId: string | undefined
  createdAt: number | string | undefined
  totalMembers: number | undefined
  rawMessage: string
}

function extractSummaryData(event: unknown): EventSummaryData {
  const data = event as Record<string, unknown> | null
  if (data === null || typeof data !== 'object') {
    return {
      instanceName: 'unknown',
      bridgeId: undefined,
      createdAt: undefined,
      totalMembers: undefined,
      rawMessage: ''
    }
  }

  const instanceName = typeof data.instanceName === 'string' ? data.instanceName : 'unknown'
  const bridgeId =
    typeof data.bridgeId === 'string' ? data.bridgeId : typeof data.bridge === 'string' ? data.bridge : undefined

  const createdAt =
    typeof data.createdAt === 'number' || typeof data.createdAt === 'string'
      ? data.createdAt
      : typeof data.timestamp === 'number'
        ? data.timestamp
        : undefined

  const totalMembers =
    typeof data.totalMembers === 'number'
      ? data.totalMembers
      : typeof data.memberCount === 'number'
        ? data.memberCount
        : undefined

  const rawMessage =
    typeof data.message === 'string'
      ? data.message
      : typeof data.rawMessage === 'string'
        ? data.rawMessage
        : typeof data.text === 'string'
          ? data.text
          : typeof data.content === 'string'
            ? data.content
            : ''

  return { instanceName, bridgeId, createdAt, totalMembers, rawMessage }
}

export function formatEventSummary(name: string, event: unknown): string {
  try {
    const { instanceName, bridgeId, createdAt, totalMembers, rawMessage } = extractSummaryData(event)
    const clean = truncate(stripColorCodesAndNormalize(rawMessage), 120)

    const parts = [`[${name}]`, `instance=${instanceName}`, `bridge=${bridgeId ?? 'n/a'}`]
    if (clean.length > 0) parts.push(`msg="${clean.replaceAll('"', "'")}"`)
    if (totalMembers !== undefined) parts.push(`totalMembers=${totalMembers}`)
    if (createdAt !== undefined) parts.push(`createdAt=${createdAt}`)
    return parts.join(' ')
  } catch {
    try {
      return `[${name}] ${JSON.stringify(event)}`
    } catch {
      return `[${name}] (unserializable event)`
    }
  }
}
