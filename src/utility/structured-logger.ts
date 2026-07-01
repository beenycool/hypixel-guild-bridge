import type { Logger } from 'log4js'

export function structuredInfo(logger: Logger, event: string, data: Record<string, unknown>, message?: string): void {
  const parts = [`event=${event}`]
  for (const [key, value] of Object.entries(data)) {
    parts.push(`${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
  }
  if (message) parts.push(`msg=${JSON.stringify(message)}`)
  logger.info(parts.join(' '))
}

export function structuredWarn(logger: Logger, event: string, data: Record<string, unknown>, message?: string): void {
  const parts = [`event=${event}`]
  for (const [key, value] of Object.entries(data)) {
    parts.push(`${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
  }
  if (message) parts.push(`msg=${JSON.stringify(message)}`)
  logger.warn(parts.join(' '))
}

export function structuredError(logger: Logger, event: string, data: Record<string, unknown>, error?: unknown): void {
  const parts = [`event=${event}`]
  for (const [key, value] of Object.entries(data)) {
    parts.push(`${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
  }
  if (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    parts.push(`error=${JSON.stringify(errorMessage)}`)
  }
  logger.error(parts.join(' '))
}
