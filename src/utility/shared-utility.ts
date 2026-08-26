import assert from 'node:assert'

import Logger4js from 'log4js'

import { InternalInstancePrefix } from '../common/instance.js'

import Duration from './duration'

export function antiSpamString(): string {
  let randomString = ''
  const charSet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const length = 6

  for (let index = 0; index < length; index++) {
    const randomIndex = Math.floor(Math.random() * charSet.length)
    randomString += charSet.charAt(randomIndex)
  }

  return randomString
}

export function formatTime(milliseconds: number, maxPrecision = 2): string {
  assert.ok(maxPrecision >= 1, 'Minimum precision is 1')

  const Year = Duration.years(1).toSeconds()

  let result = ''
  let variablesSet = 0
  let remaining = Math.floor(milliseconds / 1000)

  const years = Math.floor(remaining / Year)
  if (years > 0) {
    result += `${years}y`
    if (++variablesSet >= maxPrecision) return result
  }
  remaining = remaining % Year

  const days = Math.floor(remaining / 86_400)
  if (days > 0) {
    result += `${days}d`
    if (++variablesSet >= maxPrecision) return result
  }
  remaining = remaining % 86_400

  const hours = Math.floor(remaining / 3600)
  if (hours > 0) {
    result += `${hours}h`
    if (++variablesSet >= maxPrecision) return result
  }
  remaining = remaining % 3600

  const minutes = Math.floor(remaining / 60)
  if (minutes > 0) {
    result += `${minutes}m`
    if (++variablesSet >= maxPrecision) return result
  }
  remaining = remaining % 60

  result += `${remaining}s`
  return result
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function gracefullyExitProcess(exitCode: number): Promise<void> {
  const timeout = sleep(30_000).then(() => {
    // eslint-disable-next-line no-restricted-syntax
    console.warn('Logger flush timed out. Exiting...')
    process.exit(exitCode)
  })

  Logger4js.shutdown(() => {
    process.exit(exitCode)
  })

  await timeout
}

export function beautifyInstanceName(instanceName: string): string {
  instanceName = instanceName.startsWith(InternalInstancePrefix)
    ? instanceName.slice(InternalInstancePrefix.length)
    : instanceName

  if (instanceName !== instanceName.toLowerCase()) return instanceName

  instanceName = instanceName
    .replaceAll('-', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')

  return instanceName
}

export function relativeTime(timestamp: number, includeSuffix = true): string {
  const diff = timestamp - Date.now()
  const absSeconds = Math.floor(Math.abs(diff) / 1000)

  let result: string
  if (absSeconds < 10) result = 'a few seconds'
  else if (absSeconds < 45) result = `${absSeconds} seconds`
  else if (absSeconds < 90) result = 'a minute'
  else if (absSeconds < 45 * 60) result = `${Math.round(absSeconds / 60)} minutes`
  else if (absSeconds < 90 * 60) result = 'an hour'
  else if (absSeconds < 22 * 60 * 60) result = `${Math.round(absSeconds / 3600)} hours`
  else if (absSeconds < 36 * 60 * 60) result = 'a day'
  else if (absSeconds < 26 * 24 * 60 * 60) result = `${Math.round(absSeconds / 86_400)} days`
  else if (absSeconds < 45 * 24 * 60 * 60) result = 'a month'
  else if (absSeconds < 345 * 24 * 60 * 60) result = `${Math.round(absSeconds / 2_592_000)} months`
  else if (absSeconds < 545 * 24 * 60 * 60) result = 'a year'
  else result = `${Math.round(absSeconds / 31_536_000)} years`

  if (!includeSuffix) return result
  return diff > 0 ? `in ${result}` : `${result} ago`
}

export function search(query: string, collection: string[]): string[] {
  const copy = [...collection]
  copy.sort((a, b) => a.localeCompare(b))

  const queryLowerCased = query.toLowerCase()
  const results: string[] = []

  for (const username of copy) {
    if (!results.includes(username) && username.toLowerCase().startsWith(queryLowerCased)) {
      results.push(username)
    }
  }

  for (const username of copy) {
    if (!results.includes(username) && username.toLowerCase().includes(queryLowerCased)) {
      results.push(username)
    }
  }

  return results
}
