import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'

import { satisfies } from 'compare-versions'
import type { Configuration } from 'log4js'
import Logger4js from 'log4js'

import PackageJson from './package.json' with { type: 'json' }
import Application from './src/application.js'
import { Instance } from './src/common/instance'
import { loadApplicationConfig, parseApplicationConfig } from './src/configuration-parser.js'
import { loadI18 } from './src/i18next'
import { gracefullyExitProcess } from './src/utility/shared-utility'

const RequiredNodeVersion = PackageJson.engines.node
const ActualNodeVersion = process.versions.node
if (!satisfies(ActualNodeVersion, RequiredNodeVersion)) {
  // eslint-disable-next-line no-restricted-syntax
  console.error(
    `Application can not start due to Node.js being outdated.\n` +
      `This application depends on Node.js to work.\n` +
      `Please update Node.js before trying to launch the application again.\n` +
      'You can download Node.js latest version here: https://nodejs.org/en/download\n' +
      `Current version: ${ActualNodeVersion}, Required version: ${RequiredNodeVersion}`
  )
  process.exit(1)
}

const RootDirectory = import.meta.dirname
const ConfigsDirectory = process.env.CONFIG_DIR
  ? path.resolve(process.env.CONFIG_DIR)
  : path.resolve(RootDirectory, 'config')

try {
  if (!fs.existsSync(ConfigsDirectory)) {
    fs.mkdirSync(ConfigsDirectory, { recursive: true })
  }
} catch (error) {
  // eslint-disable-next-line no-restricted-syntax
  console.warn(`Failed to create config directory: ${ConfigsDirectory}`, error)
}

const LoggerConfigName = 'log4js-config.json'
const LoggerPath = path.join(ConfigsDirectory, LoggerConfigName)
if (!fs.existsSync(LoggerPath)) {
  try {
    fs.copyFileSync(path.join(RootDirectory, 'src', LoggerConfigName), LoggerPath)
  } catch (error) {
    // eslint-disable-next-line no-restricted-syntax
    console.error('Failed to copy logger config file:', error)
  }
}
let loggerConfig: Configuration
try {
  loggerConfig = JSON.parse(fs.readFileSync(LoggerPath, 'utf8')) as Configuration
} catch (error) {
  // eslint-disable-next-line no-restricted-syntax
  console.error('Failed to parse logger config:', error)
  throw error
}
const Logger = Logger4js.configure(loggerConfig).getLogger('Main')

const ExternalPort = Number(process.env.PORT ?? 80)
const InternalPort = Number(process.env.INTERNAL_PORT ?? 9091)
const PrometheusPort = Number(process.env.PROMETHEUS_PORT ?? 9090)
process.env.INTERNAL_PORT = String(InternalPort)

Logger.info('Starting application...')
Logger.info(`Root Directory: ${RootDirectory}`)
Logger.info(`Config Directory: ${ConfigsDirectory}`)
Logger.info('Environment:')
Logger.info(`PORT: ${process.env.PORT}`)
Logger.info(`INTERNAL_PORT: ${process.env.INTERNAL_PORT}`)

const ProcessStartTime = Date.now()

const HealthServer = http.createServer((request, response) => {
  try {
    const url = request.url ?? '/'
    if (url.split('?')[0] === '/uptime' || url.split('?')[0] === '/health') {
      response.writeHead(200, { ['Content-Type']: 'application/json' })
      response.end(
        JSON.stringify({
          status: 'ok',
          uptime: Date.now() - ProcessStartTime,
          version: PackageJson.version
        })
      )
      return
    }

    const pathname = url.split('?')[0]
    if (pathname === '/metrics' || pathname === '/ping') {
      const metricsToken = process.env.GRAFANA_METRICS_TOKEN
      if (!metricsToken) {
        response.writeHead(401, { ['Content-Type']: 'text/plain' })
        response.end('Unauthorized — set GRAFANA_METRICS_TOKEN to enable metrics endpoint')
        return
      }
      const authHeader = request.headers.authorization
      const queryToken = url.includes('?') ? new URLSearchParams(url.split('?')[1]).get('token') : undefined
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
      const basicMatch = authHeader?.startsWith('Basic ')
        ? Buffer.from(authHeader.slice(6), 'base64').toString().split(':')[1]
        : undefined
      const tokenOk = queryToken === metricsToken || bearer === metricsToken || basicMatch === metricsToken
      if (!tokenOk) {
        response.writeHead(401, { ['Content-Type']: 'text/plain' })
        response.end('Unauthorized')
        return
      }
    }
    const proxyPort = pathname === '/metrics' || pathname === '/ping' ? PrometheusPort : InternalPort

    const proxy = http.request(
      { hostname: '127.0.0.1', port: proxyPort, path: url, method: request.method, headers: request.headers },
      (proxyResponse) => {
        response.writeHead(proxyResponse.statusCode ?? 200, proxyResponse.headers)
        proxyResponse.pipe(response, { end: true })
      }
    )

    proxy.on('error', (error) => {
      // eslint-disable-next-line no-restricted-syntax
      console.error('Proxy error:', error)
      response.writeHead(502)
      response.end('Bad gateway')
    })

    request.pipe(proxy, { end: true })
  } catch (error) {
    // eslint-disable-next-line no-restricted-syntax
    console.error('Health proxy request error:', error)
    response.writeHead(500)
    response.end('Internal error')
  }
})

HealthServer.on('clientError', () => {})

HealthServer.on('upgrade', (request, socket, head) => {
  const pathname = request.url ? request.url.split('?')[0] : '/'
  const proxyPort = pathname === '/metrics' || pathname === '/ping' ? PrometheusPort : InternalPort

  const proxy = http.request({
    hostname: '127.0.0.1',
    port: proxyPort,
    path: request.url ?? '/',
    method: 'GET',
    headers: request.headers
  })

  proxy.on('upgrade', (proxyResponse, proxySocket) => {
    proxySocket.write(head)
    proxySocket.pipe(socket).pipe(proxySocket)
  })

  proxy.on('error', () => socket.destroy())
  proxy.end()
})

HealthServer.listen(ExternalPort, () => {
  Logger.info(`Health proxy listening on port ${ExternalPort} → proxying to ${InternalPort}`)
})

let app: Application | undefined

process.on('uncaughtException', function (error) {
  Logger.fatal(error)
  process.exit(1)
})

let shutdownStarted = false
function handleShutdown(signal: string) {
  if (shutdownStarted) {
    Logger.info(`Process has caught ${signal} signal. Already shutting down. Wait!!`)
    return
  }

  shutdownStarted = true
  Logger.info(`Process has caught ${signal} signal.`)
  HealthServer.close()
  if (app === undefined) {
    gracefullyExitProcess(0).catch(() => process.exit(1))
  } else {
    void app
      .shutdown()
      .then(() => gracefullyExitProcess(0))
      .catch(() => {
        process.exit(1)
      })
  }
}
process.on('SIGINT', handleShutdown)
process.on('SIGTERM', handleShutdown)

process.title = PackageJson.name

const I18n = await loadI18()

if (process.argv.includes('test-run')) {
  Logger.warn('Argument passed to run in testing mode')
  Logger.warn('Test Loading finished.')
  Logger.warn('Returning from program with exit code 0')
  await gracefullyExitProcess(0)
}

const ConfigPath = ((): string => {
  if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH
  if (process.argv[2]) return process.argv[2]
  return './config.yaml'
})()
let config: ReturnType<typeof loadApplicationConfig>

if (process.env.CONFIG_B64) {
  Logger.info('Loading configuration from base64 environment variable "CONFIG_B64"')
  try {
    const decoded = Buffer.from(process.env.CONFIG_B64, 'base64').toString('utf8')
    config = parseApplicationConfig(decoded)
  } catch (error) {
    Logger.fatal('Failed to decode CONFIG_B64 environment variable')
    Logger.fatal(error)
    await gracefullyExitProcess(1)
    throw new Error('Process should have exited')
  }
} else if (process.env.CONFIG) {
  Logger.info('Loading configuration from environment variable "CONFIG"')
  try {
    config = parseApplicationConfig(process.env.CONFIG)
  } catch (error) {
    Logger.fatal('Failed to parse CONFIG environment variable')
    Logger.fatal(error)
    await gracefullyExitProcess(1)
    throw new Error('Process should have exited')
  }
} else {
  if (!fs.existsSync(ConfigPath)) {
    Logger.fatal(`File ${ConfigPath} does not exist.`)
    Logger.fatal(`You can rename config_example.yaml to config.yaml and use it as the configuration file.`)
    Logger.fatal(`If this is the first time running the application, please read README.md before proceeding.`)
    await gracefullyExitProcess(1)
    throw new Error('Process should have exited')
  }
  config = loadApplicationConfig(ConfigPath)
}

interface EventSummaryData {
  instanceName?: string
  bridge?: string
  bridgeId?: string
  timestamp?: number
  createdAt?: string
  totalMembers?: number
  memberCount?: number
  message?: string
  rawMessage?: string
  text?: string
  content?: string
}

try {
  app = new Application(config, RootDirectory, ConfigsDirectory, I18n.cloneInstance())

  const loggers = new Map<string, Logger4js.Logger>()

  const EventTrace = Boolean(process.env.EVENT_TRACE ?? process.env.LOG_EVENT_JSON)

  const NoisyEvents = new Set([
    'minecraftChat',
    'chat',
    'guildPlayer',
    'guildGeneral',
    'minecraftChatEvent',
    'minecraftSelfBroadcast'
  ])

  const LoggedEvents = new Set(['error', 'instanceStatus', 'bridgeConfigChanged'])

  function stripColorCodesAndNormalize(s: unknown): string {
    if (s == undefined) return ''
    if (typeof s !== 'string' && typeof s !== 'number' && typeof s !== 'boolean') return ''
    const inputString = String(s)

    return inputString
      .replaceAll(/\u00A7[0-9a-fk-or]/gi, '')
      .replaceAll(/\s+/g, ' ')
      .trim()
  }

  function truncate(s: string, n = 120): string {
    if (s.length <= n) return s
    return s.slice(0, n - 1) + '…'
  }

  function isGuildListLine(message: string): boolean {
    const trimmed = message.trim()
    if (trimmed.startsWith('Guild Name:')) return true
    if (trimmed.startsWith('--') && trimmed.endsWith('--')) return true
    if (trimmed.startsWith('Total Members:')) return true
    if (trimmed.startsWith('Online Members:')) return true
    return false
  }

  function formatEventSummary(name: string, event: unknown): string {
    try {
      const eventData = event as EventSummaryData
      const instanceName = eventData.instanceName ?? 'unknown'
      const bridgeId = eventData.bridgeId ?? eventData.bridge ?? 'n/a'
      const createdAt = eventData.createdAt ?? eventData.timestamp
      const totalMembers = eventData.totalMembers ?? eventData.memberCount

      const rawMessage = eventData.message ?? eventData.rawMessage ?? eventData.text ?? eventData.content ?? ''
      const clean = truncate(stripColorCodesAndNormalize(rawMessage), 120)

      const parts = [`[${name}]`, `instance=${instanceName}`, `bridge=${bridgeId}`]
      if (clean.length > 0) parts.push(`msg="${clean.replaceAll('"', "'")}"`)
      if (totalMembers !== undefined) parts.push(`totalMembers=${totalMembers}`)
      if (createdAt !== undefined) parts.push(`createdAt="${createdAt}"`)
      return parts.join(' ')
    } catch (error) {
      Logger.debug('formatEventSummary error:', error)

      try {
        return `[${name}] ${JSON.stringify(event)}`
      } catch {
        return `[${name}] (unserializable event)`
      }
    }
  }

  app.onAny((name, event) => {
    const eventData = event as EventSummaryData
    const instanceName = eventData.instanceName ?? 'unknown'

    if (name === 'minecraftChat') {
      const message = eventData.message ?? eventData.rawMessage ?? ''
      if (isGuildListLine(message)) return
    }

    if (!LoggedEvents.has(name) && !NoisyEvents.has(name)) return

    let instanceLogger = loggers.get(instanceName)
    if (instanceLogger === undefined) {
      instanceLogger = Instance.createLogger(instanceName)
      loggers.set(instanceName, instanceLogger)
    }

    if (EventTrace) {
      try {
        instanceLogger.info(`[${name}] ${JSON.stringify(event)}`)
      } catch {
        instanceLogger.info(`[${name}] (unserializable event)`)
      }
      return
    }

    if (NoisyEvents.has(name)) {
      instanceLogger.info(formatEventSummary(name, event))
    } else if (LoggedEvents.has(name)) {
      try {
        instanceLogger.info(`[${name}] ${JSON.stringify(event)}`)
      } catch {
        instanceLogger.info(`[${name}] (unserializable event)`)
      }
    }
  })

  await app.start()
  Logger.info('App is connected')
} catch (error: unknown) {
  Logger.fatal(error)
  Logger.fatal('stopping the process for the controller to restart this node...')
  process.exit(1)
}
