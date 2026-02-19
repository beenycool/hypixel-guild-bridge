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

// Azure App Service compatibility: default to port 80 if no port is provided.
// We also export INTERNAL_PORT so the application config can use ${INTERNAL_PORT}.
const externalPort = Number(process.env.WEBSITES_PORT ?? process.env.PORT ?? 80)
const internalPort = Number(process.env.INTERNAL_PORT ?? 9091)
const prometheusPort = Number(process.env.PROMETHEUS_PORT ?? 9090)
process.env.INTERNAL_PORT = String(internalPort)

console.log(`Starting application...`)
console.log(`Root Directory: ${RootDirectory}`)
console.log(`Config Directory: ${ConfigsDirectory}`)
console.log(`Environment:`)
console.log(`WEBSITES_PORT: ${process.env.WEBSITES_PORT}`)
console.log(`PORT: ${process.env.PORT}`)
console.log(`INTERNAL_PORT: ${process.env.INTERNAL_PORT}`)

try {
  if (!fs.existsSync(ConfigsDirectory)) {
    console.log(`Creating config directory: ${ConfigsDirectory}`)
    fs.mkdirSync(ConfigsDirectory, { recursive: true })
  }
} catch (error) {
  console.error(`Failed to create config directory: ${ConfigsDirectory}`, error)
  // Don't exit, let it try to continue or fail later with better logs
}

// Start a lightweight health/proxy server immediately to satisfy Azure startup probes.
// It listens on the external port (WEBSITES_PORT) and responds 200 on `/uptime` quickly.
// All other requests are proxied to the internal application port (INTERNAL_PORT) so
// the real web server can boot on the internal port without exposing the slow startup window.
const processStartTime = Date.now()

const healthServer = http.createServer((req, res) => {
  try {
    const url = req.url ?? '/'
    if (url.split('?')[0] === '/uptime' || url.split('?')[0] === '/health') {
      // Respond immediately for probes
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: Date.now() - processStartTime,
          version: PackageJson?.version ?? process.env.npm_package_version
        })
      )
      return
    }

    // Proxy /metrics and /ping to Prometheus (runs on its own port)
    const pathname = url.split('?')[0]
    const proxyPort = pathname === '/metrics' || pathname === '/ping' ? prometheusPort : internalPort

    const proxy = http.request(
      { hostname: '127.0.0.1', port: proxyPort, path: url, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
        proxyRes.pipe(res, { end: true })
      }
    )

    proxy.on('error', () => {
      res.writeHead(502)
      res.end('Bad gateway')
    })

    req.pipe(proxy, { end: true })
  } catch (err) {
    res.writeHead(500)
    res.end('Internal error')
  }
})

healthServer.on('clientError', () => {
  // ignore occasional client errors from probes
})

healthServer.listen(externalPort, () => {
  // avoid log4js (not configured yet), use console for early message
  console.log(`Health proxy listening on port ${externalPort} → proxying to ${internalPort}`)
})

process.on('SIGINT', () => healthServer.close())
process.on('SIGTERM', () => healthServer.close())


const LoggerConfigName = 'log4js-config.json'
const LoggerPath = path.join(ConfigsDirectory, LoggerConfigName)
if (!fs.existsSync(LoggerPath)) {
  fs.copyFileSync(path.join(RootDirectory, 'src', LoggerConfigName), LoggerPath)
}
const LoggerConfig = JSON.parse(fs.readFileSync(LoggerPath, 'utf8')) as Configuration
const Logger = Logger4js.configure(LoggerConfig).getLogger('Main')
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

const File = process.env.CONFIG_PATH ?? process.argv[2] ?? './config.yaml'
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
  if (!fs.existsSync(File)) {
    Logger.fatal(`File ${File} does not exist.`)
    Logger.fatal(`You can rename config_example.yaml to config.yaml and use it as the configuration file.`)
    Logger.fatal(`If this is the first time running the application, please read README.md before proceeding.`)
    await gracefullyExitProcess(1)
    throw new Error('Process should have exited')
  }
  config = loadApplicationConfig(File)
}

try {
  app = new Application(config, RootDirectory, ConfigsDirectory, I18n.cloneInstance())

  const loggers = new Map<string, Logger4js.Logger>()
  app.onAny((name, event) => {
    const instanceName = (event as any).instanceName ?? 'unknown'
    let instanceLogger = loggers.get(instanceName)
    if (instanceLogger === undefined) {
      instanceLogger = Instance.createLogger(instanceName)
      loggers.set(instanceName, instanceLogger)
    }
    instanceLogger.log(`[${name}] ${JSON.stringify(event)}`)
  })

  await app.start()
  Logger.info('App is connected')
} catch (error: unknown) {
  Logger.fatal(error)
  Logger.fatal('stopping the process for the controller to restart this node...')
  process.exit(1)
}
