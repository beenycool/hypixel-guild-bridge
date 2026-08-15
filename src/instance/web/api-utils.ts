// eslint-disable-next-line unicorn/prevent-abbreviations -- filename is imported as api-utils across the repo
import type http from 'node:http'

interface ApiSuccess<T = unknown> {
  success: true
  data: T
}

interface ApiError {
  success: false
  error: {
    code: string
    message: string
  }
}

export function sendSuccess(response: http.ServerResponse, data: unknown, statusCode = 200): void {
  const body: ApiSuccess = { success: true, data }
  // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the protocol
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

export function sendError(response: http.ServerResponse, code: string, message: string, statusCode = 400): void {
  const body: ApiError = { success: false, error: { code, message } }
  // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name required by the protocol
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}
