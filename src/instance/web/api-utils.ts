import http from 'node:http'

export interface ApiSuccess<T = unknown> {
  success: true
  data: T
}

export interface ApiError {
  success: false
  error: {
    code: string
    message: string
  }
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError

export function sendSuccess<T>(res: http.ServerResponse, data: T, statusCode = 200): void {
  const body: ApiSuccess<T> = { success: true, data }
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function sendError(res: http.ServerResponse, code: string, message: string, statusCode = 400): void {
  const body: ApiError = { success: false, error: { code, message } }
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
