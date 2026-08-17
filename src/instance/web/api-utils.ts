// eslint-disable-next-line unicorn/prevent-abbreviations
import type http from 'node:http'

import type { Logger } from 'log4js'

export function sendSuccess(response: http.ServerResponse, data: unknown, statusCode = 200): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ success: true, data }))
}

export function sendError(response: http.ServerResponse, code: string, message: string, statusCode = 400): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ success: false, error: { code, message } }))
}

export function sendMethodNotAllowed(response: http.ServerResponse): void {
  sendError(response, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405)
}

export async function readBody(request: http.IncomingMessage): Promise<string> {
  request.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      resolve(body)
    })
    request.on('error', reject)
  })
}

export async function readJsonBody<T = unknown>(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  logger?: Logger
): Promise<T | undefined> {
  let raw: string
  try {
    raw = await readBody(request)
  } catch (error: unknown) {
    logger?.warn('Failed to read request body', error)
    sendError(response, 'INTERNAL_ERROR', 'Failed to read request body', 400)
    return undefined
  }

  if (raw.trim().length === 0) {
    sendError(response, 'VALIDATION_ERROR', 'Missing request body', 400)
    return undefined
  }

  try {
    return JSON.parse(raw) as T
  } catch (error: unknown) {
    logger?.warn('Invalid JSON body', error)
    sendError(response, 'VALIDATION_ERROR', 'Invalid JSON body', 400)
    return undefined
  }
}
