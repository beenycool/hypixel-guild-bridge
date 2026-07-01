import log4js from 'log4js'

export function createLogger(name: string) {
  return log4js.getLogger(name)
}

const SENSITIVE_KEYS = new Set(['apiKey', 'key', 'token', 'password', 'secret', 'authorization'])

export function sanitizeForLog(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return obj
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj
  if (Array.isArray(obj)) return obj.map(sanitizeForLog)
  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) {
        sanitized[key] = '***'
      } else {
        sanitized[key] = sanitizeForLog(value)
      }
    }
    return sanitized
  }
  return obj
}
