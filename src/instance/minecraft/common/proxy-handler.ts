import Http from 'node:http'

import type { Logger } from 'log4js'
import type { Client } from 'minecraft-protocol'
import { SocksClient } from 'socks'

import type { ProxyConfig } from '../../../core/minecraft/sessions-manager'
import { ProxyProtocol } from '../../../core/minecraft/sessions-manager'
import { QuitProxyError } from '../handlers/state-handler.js'

export function resolveProxyIfExist(
  logger: Logger,
  proxyConfig: ProxyConfig | undefined,
  defaultBotOptions: {
    host: string
    port: number
  }
): Partial<ClientProxyOptions> {
  if (!proxyConfig) return {}

  const proxyHost = proxyConfig.host
  const proxyPort = proxyConfig.port
  const protocol = proxyConfig.protocol
  const host = defaultBotOptions.host
  const port = defaultBotOptions.port

  let connect: (client: Client) => void
  switch (protocol) {
    case ProxyProtocol.Http: {
      connect = createHttpConnectFunction(logger, proxyHost, proxyPort, host, port)
      break
    }

    case ProxyProtocol.Socks5: {
      connect = createSocksConnectFunction(logger, proxyConfig, host, port)
      break
    }
    default: {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unknown proxy protocol '${protocol}'`)
    }
  }

  return { connect }
}

function createHttpConnectFunction(logger: Logger, proxyHost: string, proxyPort: number, host: string, port: number) {
  return function (client: Client): void {
    const request = Http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: host + ':' + String(port)
    })
    request.end()

    request.on('connect', (response, stream) => {
      client.setSocket(stream)
      client.emit('connect')
    })

    request.once('error', (error) => {
      client.emit('error', new Error('proxy encountered a problem', { cause: error }))

      logger.error('destroying proxy socket')
      request.destroy(error)
    })
  }
}

function createSocksConnectFunction(
  logger: Logger,
  proxyOptions: Omit<ProxyConfig, 'protocol'>,
  host: string,
  port: number
) {
  return function (client: Client): void {
    SocksClient.createConnection({
      proxy: {
        host: proxyOptions.host,
        port: proxyOptions.port,
        type: 5,

        userId: proxyOptions.user,
        password: proxyOptions.password
      },
      command: 'connect',
      destination: {
        host,
        port
      }
    })
      .then((connectionEstablished) => {
        client.setSocket(connectionEstablished.socket)
        client.emit('connect')
      })
      .catch((error: unknown) => {
        client.emit('error', new Error(QuitProxyError, { cause: error }))

        logger.warn('ending minecraft session if any exist')
        client.end()
      })
  }
}

export interface ClientProxyOptions {
  connect: (client: Client) => void
}
