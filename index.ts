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
  console.warn(`Failed to create config directory: ${ConfigsDirectory}`, error)
}

const LoggerConfigName = 'log4js-config.json'
const LoggerPath = path.join(ConfigsDirectory, LoggerConfigName)
if (!fs.existsSync(LoggerPath)) {
  try {
    fs.copyFileSync(path.join(RootDirectory, 'src', LoggerConfigName), LoggerPath)
  } catch (error) {
    console.error('Failed to copy logger config file:', error)
  }
}
let LoggerConfig: Configuration
try {
  LoggerConfig = JSON.parse(fs.readFileSync(LoggerPath, 'utf8')) as Configuration
} catch (error) {
  console.error('Failed to parse logger config:', error)
  throw error
}
const Logger = Logger4js.configure(LoggerConfig).getLogger('Main')

// Default to port 80 if no port is provided (common in containers).
// We also export INTERNAL_PORT so the application config can use ${INTERNAL_PORT}.
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

// Start a lightweight health/proxy server immediately so load balancers get fast `/health`/`/uptime`.
// It listens on the external port (PORT) and responds 200 on `/uptime` quickly.
// All other requests are proxied to the internal application port (INTERNAL_PORT) so
// the real web server can boot on the internal port without exposing the slow startup window.
const ProcessStartTime = Date.now()

const HealthServer = http.createServer((request, response) => {
  try {
    const url = request.url ?? '/'
    if (url.split('?')[0] === '/uptime' || url.split('?')[0] === '/health') {
      // Respond immediately for probes
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

    // Proxy /metrics and /ping to Prometheus (runs on its own port)
    const pathname = url.split('?')[0]
    if (pathname === '/metrics' || pathname === '/ping') {
      const metricsToken = process.env.GRAFANA_METRICS_TOKEN
      if (metricsToken) {
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
      console.error('Proxy error:', error)
      response.writeHead(502)
      response.end('Bad gateway')
    })

    request.pipe(proxy, { end: true })
  } catch (error) {
    console.error('Health proxy request error:', error)
    response.writeHead(500)
    response.end('Internal error')
  }
})

HealthServer.on('clientError', () => {
  // ignore occasional client errors from probes
})

HealthServer.listen(ExternalPort, () => {
  Logger.info(`Health proxy listening on port ${ExternalPort} → proxying to ${InternalPort}`)
})

process.on('SIGINT', () => HealthServer.close())
process.on('SIGTERM', () => HealthServer.close())

let app: Application | undefined

Logger.debug('Setting up process...')
process.on('uncaughtException', function (error) {
  Logger.fatal(error)
  process.exitCode = 1
})

let shutdownStarted = false
process.on('SIGINT', (signal) => {
  if (shutdownStarted) {
    Logger.info(`Process has caught ${signal} signal. Already shutting down. Wait!!`)
    return
  }

  shutdownStarted = true
  Logger.info(`Process has caught ${signal} signal.`)
  if (app !== undefined) {
    Logger.debug('Shutting down application')
    void app
      .shutdown()
      .then(() => gracefullyExitProcess(0))
      .catch(() => {
        process.exit(1)
      })
  }
})

process.title = PackageJson.name

Logger.debug('Loading up languages...')
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

// Priority order for loading configuration:
// 1. CONFIG_B64 - base64-encoded YAML/JSON (recommended for platforms that strip newlines)
// 2. CONFIG - raw YAML/JSON string
// 3. config file on disk (default: ./config.yaml)
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

interface WebSocketEventData {
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

  // Environment toggle to enable full JSON event dumps for debugging
  const EventTrace = Boolean(process.env.EVENT_TRACE ?? process.env.LOG_EVENT_JSON)

  // Events considered "noisy" (high-volume chat-like events) — emit concise summaries instead
  const NoisyEvents = new Set([
    'minecraftChat',
    'chat',
    'guildPlayer',
    'guildGeneral',
    'minecraftChatEvent',
    'minecraftSelfBroadcast'
  ])

  function stripColorCodesAndNormalize(s: unknown): string {
    if (s == undefined) return ''
    if (typeof s !== 'string' && typeof s !== 'number' && typeof s !== 'boolean') return ''
    const inputString = String(s)
    // Strip common Minecraft color codes (e.g. §a) and collapse whitespace
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
    if (trimmed.startsWith('-----------------------------------------------------')) return true
    if (trimmed.startsWith('Total Members:')) return true
    if (trimmed.startsWith('Online Members:')) return true
    return false
  }

  function formatEventSummary(name: string, event: unknown): string {
    try {
      const eventData = event as WebSocketEventData
      const instanceName = eventData.instanceName ?? 'unknown'
      const bridgeId = eventData.bridgeId ?? eventData.bridge ?? 'n/a'
      const createdAt = eventData.createdAt ?? eventData.timestamp
      const totalMembers = eventData.totalMembers ?? eventData.memberCount

      // Prefer commonly used message fields
      const rawMessage = eventData.message ?? eventData.rawMessage ?? eventData.text ?? eventData.content ?? ''
      const clean = truncate(stripColorCodesAndNormalize(rawMessage), 120)

      const parts = [`[${name}]`, `instance=${instanceName}`, `bridge=${bridgeId}`]
      if (clean.length > 0) parts.push(`msg="${clean.replaceAll('"', "'")}"`)
      if (totalMembers !== undefined) parts.push(`totalMembers=${totalMembers}`)
      if (createdAt !== undefined) parts.push(`createdAt=${createdAt}`)
      return parts.join(' ')
    } catch (error) {
      Logger.debug('formatEventSummary error:', error)
      // Fallback to safe JSON if something unexpected happens
      try {
        return `[${name}] ${JSON.stringify(event)}`
      } catch {
        return `[${name}] (unserializable event)`
      }
    }
  }

  app.onAny((name, event) => {
    const eventData = event as WebSocketEventData
    const instanceName = eventData.instanceName ?? 'unknown'

    // Skip guild list parsing lines (they're just /guild list output, not game chat)
    if (name === 'minecraftChat') {
      const message = eventData.message ?? eventData.rawMessage ?? ''
      if (isGuildListLine(message)) return
    }

    let instanceLogger = loggers.get(instanceName)
    if (instanceLogger === undefined) {
      instanceLogger = Instance.createLogger(instanceName)
      loggers.set(instanceName, instanceLogger)
    }

    // If EventTrace is enabled, keep the previous full-JSON behaviour for debugging
    if (EventTrace) {
      // try to stringify safely
      try {
        instanceLogger.info(`[${name}] ${JSON.stringify(event)}`)
      } catch {
        instanceLogger.info(`[${name}] (unserializable event)`)
      }
      return
    }

    // For noisy events, emit a short, human-friendly summary. Other events keep a compact JSON-ish line.
    if (NoisyEvents.has(name)) {
      instanceLogger.info(formatEventSummary(name, event))
    } else {
      // For everything else, keep the concise JSON line so important info stays visible
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
