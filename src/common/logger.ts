import log4js from 'log4js'

/**
 *
 * @param name
 */
export function createLogger(name: string) {
  return log4js.getLogger(name)
}

const SENSITIVE_KEYS = new Set(['apiKey', 'key', 'token', 'password', 'secret', 'authorization'])

/**
 *
 * @param object
 */
export function sanitizeForLog(object: unknown): unknown {
  if (object === null || object === undefined) return object
  if (typeof object === 'string') return object
  if (typeof object === 'number' || typeof object === 'boolean') return object
  if (Array.isArray(object)) return object.map(sanitizeForLog)
  if (typeof object === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(object as Record<string, unknown>)) {
      sanitized[key] = SENSITIVE_KEYS.has(key) ? '***' : sanitizeForLog(value)
    }
    return sanitized
  }
  return object
}
