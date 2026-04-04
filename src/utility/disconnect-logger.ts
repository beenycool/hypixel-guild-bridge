import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const LogDirectory = 'logs'
const LogFile = join(LogDirectory, 'disconnects.log')

try {
  mkdirSync(LogDirectory, { recursive: true })
} catch {
  // Fail gracefully — logging is additive and must not block startup
}

export function logDisconnect(instanceName: string, reason: string): void {
  const timestamp = new Date().toISOString()
  const entry = `[${timestamp}] [${instanceName}] ${reason}\n`
  try {
    appendFileSync(LogFile, entry, 'utf8')
  } catch {
    // Fail gracefully — file-write errors must not abort disconnect recovery
  }
}
